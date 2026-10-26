# Dependency and supply-chain implementation plan

> Execute under `tdd-review-workflow`: native validation for dependency/config
> edits; focused RED/GREEN only if a real behavior repair becomes necessary.

## Goal and approach

Implement the approved
[design](2026-10-24-dependency-supply-chain-design.md). One parent owns manifests,
lockfile, install policy, and workflow edits. A read-only child researches CI and
native pnpm controls. Use compatible patched branches rather than blanket latest
upgrades, then review the stable candidate independently.

## Workspace and safety boundaries

Work in `/home/ensu/Projects/bastion-falls-astro`, initially `main` at
`f7bbf2e6493284ff7781864c80c1f0b4d01de572`. Preserve pre-existing manifest/lockfile
changes and unrelated content, skills, and submodule state. The pre-edit dependency
and workflow snapshot is
`/home/ensu/.hermes/cache/scratch/bf-dependency-remediation-10xuvt5r/before`.

Implementation uses branch `chore/dependency-supply-chain-2026-10-24` in the same
checkout, preserving those dirty inputs without changing the `main` branch tip.

Allowed edits are owned workspace `package.json` files, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, the three existing `.github/workflows/*.yml`, and these
supply-chain design/implementation/result documents. Extend that set only for a
specific required compatibility repair, with an existing focused test or a new
meaningful regression. Exclude `5etools-src`, unrelated content and source,
credentials, deployments, publication, repository settings, pushes, and PRs.
Leave implementation uncommitted for review: the root manifest and lockfile also
contain pre-existing user work that must not be silently included in a commit.

## Kingraph boundary

Nico plans separate work on a modernized Kingraph fork. Leave the current
`kingraph` dependency and its legacy-only dependency chain alone in this pass.
Do not remove Kingraph, replace its renderer, introduce Kingraph-specific
transitive overrides, or force incompatible versions into that chain. Preserve
its current installation permission while that separate work is deferred; do not
add new permissions to accommodate it.

Shared dependencies may receive compatible fixes through other consumers. Do not
force a shared resolution across incompatible parent requirements merely to clear
an audit finding. Keep remaining Kingraph-related findings visible and label them
deferred, rather than suppressing them or claiming a clean audit.

## Task 1: Resolve a safe dependency candidate

### Inventory and constraints

Retain the initial audit and registry metadata in the task evidence directory.
Use native `pnpm update --recursive --lockfile-only --ignore-scripts` with
Kingraph excluded, and review the resulting manifest/lock diff before executing
any installation scripts. Verify the installed CLI's argument behavior first.
Use the seven-day minimum release age during resolution, not merely after it.

Raise security-relevant direct minimums where existing ranges exclude patched
branches, notably `cli`'s `adm-zip` and `esbuild`; remove `@types/adm-zip` only if
the patched package actually supplies its own declarations. Keep Undici on its
patched 6.x branch, Mermaid on patched 11.x, Vitest on patched 4.x, Zod on patched
4.6.x, and js-yaml on patched 4.x unless verified parent compatibility requires
otherwise. Prefer compatible Astro/adapter updates.

### Residual transitive findings

Re-audit the candidate. Inspect each remaining non-Kingraph dependency's parent
manifest and currently published parent before considering an override. Do not
upgrade the schema source package solely for unrelated tool dependencies when
its newer release still excludes the patched branch. Any unavoidable scoped
override must have registry evidence, an explicit compatibility check, a comment
explaining the parent restriction, and a removal condition. Unavailable upstream
fixes remain visible blockers; do not suppress advisory IDs.

### Installation proof

Review the lock and package script changes before `pnpm install --frozen-lockfile`.
Keep the existing allowlist and make no new script grants by default. Preserve the
Kingraph chain even when its existing install scripts remain an acknowledged
risk. Retain the install log and verify real package resolution, not just lock
metadata.

## Task 2: Harden installation and CI

### pnpm policy

Set `minimumReleaseAge: 10080` (seven days). Retain narrowly necessary exact
exceptions and remove stale exceptions only after a frozen install proves they
are unnecessary. Evaluate supported native trust/integrity protections against
current pnpm 12 documentation and actual graph contents; do not invent setting
names or exempt entire packages to bypass a failure.

### Workflow changes

Modify `.github/workflows/deploy.yml`, `publish-5e-schema-zod.yml`, and
`zarifa-bot.yml`. Pin actions to verified commit SHAs annotated with their
release/ref, declare least-privilege permissions, disable persisted checkout
credentials where unused, and select the repository Node/pnpm pins with one
supported bootstrap route. Retain publishing provenance permissions only on the
publishing job. Keep Cloudflare and Discord behavior intact; credentials remain
scoped to the existing operation that needs them. Do not run a remote workflow.

Run `actionlint` on these workflows. Use native YAML/schema parsing as needed,
not bespoke source-string tests. Any notification shell/input repair receives
native parser or bounded fixture proof appropriate to the actual changed seam.

## Task 3: Verify the stable candidate

Run commands with `pnpm_config_verify_deps_before_run=false` during inspection
and verification so a check cannot silently install dependencies. Run dependent
builds in order, not concurrently against mutating generated output:

1. `pnpm -F @bastion-falls/calendar build`
1. `pnpm -F @bastion-falls/fantasy-calendar build`
1. `pnpm -F @bastion-falls/types build`
1. `pnpm -F @bastion-falls/5e-schema-zod build`
1. `pnpm -F @bastion-falls/astro-lexicon-integration build`
1. `pnpm -F @bastion-falls/satteri-auto-import build`
1. `pnpm -F @bastion-falls/satteri-markmap build`
1. `pnpm -F lex-lint build`
1. `pnpm -F @bastion-falls/cli build`
1. `pnpm -F @bastion-falls/zarifa-bot build`
1. `pnpm -F @bastion-falls/astro build`

Run each declared package test script, excluding the root's intentional
placeholder test failure. Use `NODE_ENV=test` for Vitest. Run existing typecheck
scripts, changed-file formatting, `actionlint`, Markdown checks, and
`git diff --check`. Do not run broad auto-formatters. If generation changes
tracked source unexpectedly, distinguish required compatibility changes from
verification churn and preserve unrelated baseline work.

If a gate fails, reproduce the same boundary with the original saved dependency
state before attributing it to baseline debt. Do not weaken tests or modify
content to accommodate a dependency regression. Rendered-site/browser proof is
required when build output cannot establish a changed visible contract.

## Task 4: Review and report

Freeze the task-owned candidate and request an independent read-only combined
spec/security/quality review. Provide the full approved design, Kingraph boundary,
exact changed-path allowlist, pre-existing dirty paths, and actual verification
results. Fix concrete findings and recheck only the affected boundary.

Write `docs/plans/2026-10-24-dependency-supply-chain-results.md` with direct update
rationale, retained native policies, override removal conditions, exact baseline
and candidate audit counts, all remaining advisory identities/paths and their
dispositions, actual validation outcomes, and unverified external boundaries.
A successful source/config pass does not imply deployment or remote alert closure.

The parent reviews the final delta against the saved before snapshot, confirms
Kingraph deferral and unrelated work preservation, and reports the uncommitted
handoff without pushing, publishing, or deploying.
