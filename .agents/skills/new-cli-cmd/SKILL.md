---
name: new-cli-cmd
description: >-
  Add a bfcli `new <thing>` subcommand that scaffolds MDX from a Zod schema in
  packages/types: command builder, impl, EJS template, register routes, build.
---

# New `bfcli new …` subcommands from `packages/types`

Use this skill when the user wants a **new `new` subcommand** under
`cli/src/commands/new/` that creates **MDX articles** whose frontmatter matches
a **Zod schema** exported from **`@bastion-falls/types`** (source:
`packages/types/src/<Name>.ts`).

## Goals

1. Map the target **TypeScript / Zod** type to **CLI flags** and to an **EJS
   template** that emits valid YAML frontmatter.
2. Write files into the **content tree** (e.g. `families/`, `vehicles/`) via
   `getTargetPath("<folder>")`, matching how existing articles are organized.
3. **Register** the command in `cli/src/commands/new/commands.ts` with short and
   long route names.
4. Run **`yarn build`** in **`cli/`** (or `yarn exec` for a quick run) so
   templates are copied and **TypeScript** compiles.

## Authoritative schema

- **Read first:** `packages/types/src/<Entity>.ts` — the exported **`*Schema`**
  and inferred **`*`** type drive what the MDX `key:` block must contain.
- **Import types in impl:** `import type { Foo } from "@bastion-falls/types";`
  Re-export is in `packages/types/src/index.ts`; add an `Omit<…>` for fields
  supplied elsewhere (e.g. `name` from `title`, or nested objects left for
  hand-editing).
- **Do not** invent frontmatter keys that are not in the schema (or not used by
  the site’s collection / components) unless the user explicitly extends the
  type package first.

## How the `new` command tree fits together

- **`cli/src/commands/new/commands.ts`** — `NewCommandFlags` (`--force`,
  `--tags`), `defaultFlags`, one builder per subcommand, `buildRouteMap`
  **routes**.
- **`cli/src/commands/new/<name>/command.ts`** — `buildCommand` with **stricli**
  `parameters.flags` and one **positional** string (article display name).
- **`cli/src/commands/new/<name>/impl.ts`** — Default export: async handler;
  builds `data` for the template; calls `renderTemplate`.
- **`cli/templates/<name>.ejs`** — Renders the **MDX** file: frontmatter + body
  (often `<Stub />` first).
- **`cli/src/lib/template.ts`** — Resolves `../templates` or `../../templates`,
  slugs filename from `title`, writes `*.mdx`.
- **`cli/src/config.ts`** — `getTargetPath(subdir)` → `contentDir/subdir` (see
  **Content root** below).

**Entrypoint:** `cli/src/bin/cli.ts` loads `app` from `cli/src/app.js`, which
mounts `new: newCommandRoutes` — you only extend **`commands.ts`**, not
`bin/cli.ts`, for a new subcommand.

## Content root (`.bfcli.yml`)

`getContentDir()` resolves the repo’s content base from a **`.bfcli.yml`**
upward from `cwd` (or `'_REAL_CWD'`). The CLI writes under
`getTargetPath("<folder>")` = that base + folder. Match **`<folder>`** to where
similar MDX already lives (e.g. under `astro/src/content/docs/world/species/` →
pass **`"species"`** if `contentDir` points at `.../world`).

## Step-by-step: add a subcommand for schema `Foo`

### 1. Read the Zod type and pick the content folder

- List **required** vs **optional** fields. Decide which are **flags**, which
  are **defaults in impl**, and which are **omitted** from the generator (user
  fills in complex nested structures in the file later).
- Choose `getTargetPath("…")` segment to match existing articles (plural folder
  names are common: `families`, `vehicles`, `species`).

### 2. Add `cli/templates/foo.ejs`

- Use **EJS** with `<%_ … _%>` for whitespace control where needed.
- Set `title: <%= title %>` (or rely on `renderTemplate` defaulting `title` to
  the positional name).
- Under the top-level key that matches the schema usage in the site (e.g.
  `family:`, `vehicle:`, `species:`), output only fields you pass from `data` —
  use `if` blocks for optional **YAML** keys and **iterate** arrays with
  `forEach` for list fields.
- End with a minimal body, often `<Stub />`, unless the project standard is
  different for that content type.

### 3. Add `cli/src/commands/new/foo/command.ts`

- **Pattern:**
  `export const fooCommandBuilder = (parentFlags) => buildCommand({…})`.
- **Spread** `...parentFlags` from `defaultFlags` so every subcommand gets
  `--force` and `--tags`.
- **`loader`:** `async () => import("./impl.js")` (built output uses `.js`).
- **`positional`:** one string — brief like “Name of the … to create”.
- **Flags:** mirror the schema with **stricli** kinds:
  - `kind: "parsed"`, `parse: String` — optional or required strings.
  - `kind: "parsed"`, `parse: numberParser` — numbers (import from
    `@stricli/core`).
  - `kind: "parsed"`, `parse: (s) => s.split(",").map(…)` — **comma‑separated
    lists** (see character `parents` / location patterns).
  - `kind: "enum"`, `values: [...]`, `default: "…"` — small fixed sets (e.g.
    `BaseStats` **size**).
- Mark optional flags with `optional: true`. Required flags omit `optional` or
  set `optional: false` per existing commands.

### 4. Add `cli/src/commands/new/foo/impl.ts`

- `import type { LocalContext } from "@/context.js"`.
- `import renderTemplate` and
  `import type { NewCommandFlags } from "../commands.js"`.
- `import { getTargetPath } from "@/config.js"`.
- `import type { Foo } from "@bastion-falls/types"`.
- Extend `NewCommandFlags` with your flag types; build an interface
  `FooTemplate extends TemplateData` with a `foo` (or schema key) property. Use
  `Omit<Foo, "name" | ...>` if `name` is not duplicated under `foo:` because
  **`title`** is the page title, or if nested arrays are empty stubs.
- Default export `async function foo(this: LocalContext, flags, articleName)`.
- Assemble `data` with `title: articleName`, the nested object, and
  `tags: ["<plural-or-standard-tag>", ...(tags ?? [])]`.
- Call `renderTemplate` with `name: articleName`, `template: "foo"`,
  `targetDir`, `extension: "mdx"`, `data`, `force` inside `try`/`catch`; on
  error log and `process.exit(1)` like sibling impls.

### 5. Register in `cli/src/commands/new/commands.ts`

- `import { fooCommandBuilder } from "./foo/command.js"`.
- `const fooCommand = fooCommandBuilder(defaultFlags)`.
- In `buildRouteMap({ routes: { … } })`, add **aliases** (2–3 names): e.g.
  short + singular + plural, consistent with `fam`/`family`/`families`.

### 6. Build and spot-check

- From **`cli/`:** `yarn build` — runs `tsc`, **copy-templates** (`.ejs` into
  `dist/templates/`), and **tsup**.
- Run **`bfcli`:** e.g. `yarn exec` or project‑documented entry; verify help for
  `new foo` and create a file under the expected path with `--force` if
  re-running.

## Design rules of thumb

- **Prefer a flat flag surface** for scalars; **leave** deeply nested stat
  blocks, crew lists, or sections to manual MDX for the first version of a
  command.
- **Reuse** `defaultFlags` and the same `tags` / `force` semantics as other
  `new` subcommands.
- **Match existing MDX** in `astro/src/content/docs/world/…` for the same entity
  type (key order, tag conventions, empty arrays vs omitted keys) so the
  generator output looks hand-authored.
- **Line length** in this doc: keep markdown lines around 80 characters where
  reasonable (MD013‑friendly).

## Checklist (copy for PRs)

- [ ] `packages/types/src/<Entity>.ts` read; frontmatter key names confirmed.
- [ ] `cli/templates/<name>.ejs` added.
- [ ] `cli/src/commands/new/<name>/command.ts` + `impl.ts` added.
- [ ] `cli/src/commands/new/commands.ts` updated (import, instance, routes).
- [ ] `cd cli && yarn build` succeeds.
