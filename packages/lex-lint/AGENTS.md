# lex-lint — agent / maintainer guide

This package lints **OntoLex-style** lexicon data shipped as JSON (content wrapper
with `lexicon` → `graphEntry`, or standalone JSON-LD with `@context` +
`@graph`). Optional **SHACL** checks bundled shapes. **Configurable rules** live
in `lex-lint.config.json` under `rules`.

## Pipeline

1. **Parse** JSON (strict for lexicon sources; config file allows JSONC).
2. **Route** by shape: wrapper vs `@graph` JSON-LD.
3. **Registry document rules** — `RULE_MODULES[*].lintJsonLdGraph` /
   `lintLexiconWrapper` (e.g. duplicate `@id`).
4. **Per-node** JSON-LD expand + optional SHACL on each `graphEntry` / `@graph`
   element.
5. **`applyRuleSeverities`** — honor `rules.<ruleId>` (`off` / `warn` /
   `error`). Codes starting with **`FIX_`** always stay errors.
6. **`enrichDiagnosticsWithLocations`** for line/column from `entryKey`.

**Fix mode** (`--fix` / `--fix-dry-run`): run each module’s optional `fix` in
registry order, serialize JSON-LD **preserving root key order**, with
deterministic sorting **only inside each top-level `@graph` node**, **re-lint in
memory**, then write (or print dry-run notes). Fix-time diagnostics use the
same **1-based line/column** enrichment as lint (terminal
`relativePath:line:column`, clickable in VS Code / Cursor).

## Add a lint-only rule

1. Create `src/rules/implementations/<name>.ts` exporting a **`LintRuleModule`**
   (`ruleId`, `defaultSeverity`, `codes`, and `lintJsonLdGraph` and/or
   `lintLexiconWrapper`).
2. Register it in **`src/rules/registry.ts`** (`RULE_MODULES` array order = run
   order).
3. Add the same `ruleId` to **`src/rules/effective-severity.ts`**
   `RULE_DEFAULT_SEVERITIES` (must match `defaultSeverity` on the module).
4. Document the key under `rules` in this file and add **Vitest** fixtures.

Do **not** import rule implementations from `lint-file.ts` except through the
registry.

## Add an autofix

1. Extend the same module with an optional **`fix(doc, FixContext)`** returning
   `{ doc, ok, diagnostics? }`.
2. Use **`FIX_*`** diagnostic codes for merge/skip failures; they are never
   suppressed by `off`.
3. Cover **dry-run**, **successful write**, and **abort** paths in tests.

## Conventions

- **Rule ids:** slash-namespaced JSON-LD surface rules
  (`jsonld/duplicate-graph-id`, `jsonld/root-key-order`).
  `jsonld/duplicate-graph-id` covers duplicate `@id` in `@graph` arrays and in
  wrapper `graphEntry` maps (same `@id`, different fragments).
- **Diagnostic `code`:** `SCREAMING_SNAKE`.
- **Rule-owned diagnostics:** set **`ruleId`** to the rule id string.
- **Locations:** Prefer **`jsonLocationPath`** (JSON path segments for
  `jsonc-parser`) for a precise property; otherwise **`entryKey`** heuristics.
  Enrichment fills **1-based `line` / `column`** for IDE-friendly CLI output.
- **Glob config:** `files.include` / `files.exclude` (exclude maps to `glob`
  `ignore`).

## Touch points

| Area | Role |
|------|------|
| `src/cli.ts` | Args, config merge, `--fix`, glob expansion |
| `src/config.ts` | Load / parse / validate `lex-lint.config.json` |
| `src/lint-file.ts` | Parse file, orchestrate branches, `applyRuleSeverities` |
| `src/lint-jsonld-graph.ts` | `@graph` path + registry hooks |
| `src/lint-graph-entry.ts` | JSON-LD expand + SHACL (not yet a registry rule) |
| `src/rules/registry.ts` | Ordered `RULE_MODULES` |
| `src/rules/apply-severities.ts` | `off` / `warn` / `error` filtering |
| `src/fix-pipeline.ts` | Autofix orchestration |

**SHACL** is still embedded in `lint-graph-entry.ts`; it can move behind the
registry later if the indirection is worth it.
