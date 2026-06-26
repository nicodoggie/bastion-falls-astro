# AGENTS.md - Bastion Falls Astro

This repo is the Bastion Falls workspace: an Astro/Starlight site, a TypeScript
CLI, shared content/schema packages, and supporting tooling for D&D/worldbuilding
content. Work from the repo as it exists, keep changes scoped, and prefer direct
evidence from source files, package scripts, transcripts, or generated artifacts.

## Ground Rules

^^READ THESE CAREFULLY AND DO NOT SKIP^^

- On first run in this repo, read startup instruction files directly by known path
  before any discovery step (do not depend on `rg --files`), and follow symlinks.
  At minimum, read `./AGENTS.personality.md` first.
- If AGENTS.personality.md exists, as a regular file or a symlink, read it FIRST:
  it defines your working personality and style. If the files described within have
  never been read in the context started here, consider this the explicit instruction to read them.
- If AGENTS.local.md exists, read it next. It may have local environment-specific
  agent instructions
- Use TypeScript for code changes unless you are editing existing non-TS files.
- Work in a TDD-style loop where practical: reproduce or characterize the issue,
  add or update a focused test when the behavior is testable, implement the
  smallest change, then run the narrowest useful validation.
- For docs-only, content-only, or config-only changes, use focused readback,
  schema checks, lint, or build proof instead of forcing a low-value test.
- Preserve user work in a dirty tree. Inspect status before broad edits and stage
  only files relevant to the request when committing.
- Do not treat generated output as source of truth when a schema, script, or
  source content file explains it.
- Avoid destructive commands. Prefer recoverable moves or ask first.

## Project Map

- `astro/` - Astro 7 + Starlight site. Contains MDX/content collections,
  React/Astro components, Satteri integrations, YAML homebrew data, public
  assets, and site scripts.
- `cli/` - `@bastion-falls/cli`, a Stricli-based TypeScript CLI used for
  scaffolding, DDB import, transcript workflows, and repository automation.
- `packages/types/` - shared Zod schemas and generated type artifacts.
- `packages/5e-schema-zod/` - local schema package generated from 5e data
  utilities; validate generated behavior through its scripts.
- `packages/lexicon-components/` and
  `packages/astro-lexicon-integration/` - static lexicon UI and build-time
  lexicon indexing/integration.
- `packages/lex-lint/` - OntoLex/JSON-LD lexicon linter.
- `packages/satteri-auto-import/` and `packages/satteri-markmap/` - Satteri
  plugins used by the site.
- `packages/rehype-pagefind-metadata/`,
  `packages/starlight-flatten-index/`, and
  `packages/starlight-alias-routes/` - site integration helpers.
- `packages/zarifa-bot/` - Cloudflare Workers Discord bot.
- `docs/`, `docs-scans/`, and `docs-scans-compressed/` - source notes,
  scans, and support documentation.
- `5etools-src/` - external/reference source. Exclude it from repo-wide edits,
  formatting, search-and-replace, and project summaries unless the user
  explicitly asks to inspect it.

## Commands

- Root scripts use pnpm/Turbo: `pnpm build`, `pnpm lint`, `pnpm fmt`,
  `pnpm dev`.
- Prefer package-scoped commands while iterating:
  `pnpm -F @bastion-falls/astro ...`,
  `pnpm -F @bastion-falls/cli ...`, or
  `pnpm -F <package-name> ...`.
- Site validation: `pnpm -F @bastion-falls/astro test`,
  `pnpm -F @bastion-falls/astro typecheck`,
  `pnpm -F @bastion-falls/astro lint`, and
  `pnpm -F @bastion-falls/astro build`.
- CLI validation: `pnpm -F @bastion-falls/cli test` and
  `pnpm -F @bastion-falls/cli build`.
- Package validation varies. Check the package's `package.json`; many packages
  use `node --import tsx --test`, while others use Vitest.
- Run `pnpm bfcli ...` from the repo root when using the local CLI against the
  current workspace.

## Content And Canon

- For world, character, item, spell, creature, and campaign-note work, verify
  names and facts against current pages, transcripts, notes, or imported
  artifacts before canonizing uncertain wording.
- When the user settles a disputed canon detail, update the main page and any
  active support trail that would otherwise preserve stale uncertainty.
- For Hickic and lexicon work, prefer current reference pages and lexicon shards
  over older side assets. Discuss language-wide implications before changing
  grammar or core vocabulary.
- For DDB imports, start from the exact imported JSON or campaign roster artifact
  for the requested numeric ID, then update MDX diegetically.
- For YAML homebrew data, keep YAML schema-compatible and validate with the
  package/site checks that exercise the relevant collection or endpoint.

## Editing Style

- Follow existing module boundaries and package patterns. Add abstractions only
  when they remove real duplication or match an established local pattern.
- Keep MDX readable under `rumdl`; reshape component usage when possible instead
  of disabling formatting.
- Keep generated search/index data separate from public doc routes and authored
  source content.
- For browser-visible site behavior, use real browser or DOM inspection when
  build/grep output cannot prove the rendered result.
- Comments should explain non-obvious intent, not restate the code.
