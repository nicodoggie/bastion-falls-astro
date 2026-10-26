# Kingraph Vite Migration Plan

## Goal and approved design

Use published `@nicodoggie/kingraph@0.5.0` to render existing family YAML through
Vite instead of importing checked-in generated SVGs. Register the upstream
plugin directly; retain the existing React family-tree pan/zoom viewer. The
user approved this direction and confirmed publication of the required release.

## Ownership and preservation boundaries

- Worktree: `/home/ensu/Projects/bastion-falls-astro`.
- Branch: `chore/dependency-supply-chain-2026-10-24`.
- Starting HEAD: `f7bbf2e6493284ff7781864c80c1f0b4d01de572`.
- Allowed implementation paths: `astro/package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `astro/astro.config.ts`, `astro/src/env.d.ts`, and the
  `index.mdx`/generated `family.svg` pairs under the eleven existing family
  directories: bentayga, bouillard, caxton, durant, hardpebble, malthrek,
  mcfarland, savoy, strandiz, thralmal, travertine.
- This document records the migration and results. Scratch evidence belongs
  outside the checkout, not in a permanent custom verification package.
- Preserve all family YAML, lore prose, viewer behavior, pre-existing dependency
  upgrades, unrelated content, agent skills, and submodule changes.
- Do not read secrets or credential files. Exclude `5etools-src`, `.worktrees`,
  provider-global memories, and the separate Kingraph checkout from changes.
- No staging, commits, pushes, PRs, publication, deployment, or machine-wide
  tool changes in this migration. The existing security pass stays uncommitted.

## Implementation tasks

### 1. Install and configure the published plugin

Replace the old `kingraph` development dependency with
`@nicodoggie/kingraph: ^0.5.0`. Add an exact release-age exception for the
user-published `0.5.0`, not a package-wide age/provenance bypass. Remove the
obsolete PhantomJS build permission and Kingraph-deferral comments; remove
legacy provenance exceptions only when no remaining consumer needs them.

Register `kingraph()` from `@nicodoggie/kingraph/vite` under Astro's Vite
plugins, enable `build.ssrEmitAssets`, and reference the upstream
`@nicodoggie/kingraph/vite/client` ambient declarations in `astro/src/env.d.ts`.
Use native pnpm lockfile/install commands; retain all unrelated resolutions.
Inspect the installed published entry points, not only the separate checkout.

### 2. Migrate all eleven consumers

Each page imports its image URL and named `width`/`height` exports from
`./family.yaml?kingraph`. Pass those directly to `FamilyTree`, removing the
obsolete `getImage()` and unused path imports. Preserve existing alt text,
client directives, and prose. Do not build a wrapper or another YAML loader.

Move only the eleven obsolete generated SVG files to the scratch evidence
backup after checking no other authored consumers use them. They should no
longer exist in the authored tree or be needed by development/production.

### 3. Native verification and independent review

This is direct declarative integration, not a new custom parser or renderer.
Per `tdd-review-workflow`, prefer native install, build, type, lint, asset and
browser evidence over brittle source-string tests or duplicating upstream's
Vite test suite. Add executable regression coverage only if an actual
application behavior defect appears during integration.

1. Run `pnpm install --lockfile-only --ignore-scripts`, then ordinary
   `pnpm install --frozen-lockfile` under the final supply-chain policy.
1. Run the site's declared `typecheck` and `test` scripts, changed-file Biome
   checks, and focused rumdl checks for all migrated pages and this plan.
1. Run `pnpm -F @bastion-falls/astro build`. Verify every family page's island
   points to an existing emitted SVG with positive dimensions and expected
   family labels. Confirm all eleven source YAML hashes are unchanged.
1. Serve the actual production output. Use the collaborative browser to verify
   a representative tree's image loading, pan/zoom and modal interaction.
   Verify development import/regeneration through native Vite if needed;
   upstream already owns generic plugin HMR and error-path coverage.
1. Run `pnpm audit --json`; report findings honestly, without suppression.
   Check that PhantomJS and its legacy graph are gone and narrow any obsolete
   trust-policy exceptions based on the actual final dependency graph.
1. Obtain one bounded independent specification/security/quality review of the
   migration delta against its frozen before snapshot. Preserve the earlier
   security pass's unrelated review receipts; do not replay every workspace
   suite for an Astro-only integration.
1. Record results, check `git diff --check`, and leave the tree uncommitted.

## Evidence

The pre-migration snapshot and receipts live at
`/home/ensu/.hermes/cache/scratch/bf-kingraph-vite-f82uy7w8`.

## Results

- Adopted published `@nicodoggie/kingraph@0.5.0` with its native Vite plugin,
  declarations, and server asset emission. All eleven pages now import their
  YAML directly. Removed all eleven generated source SVGs, retaining scratch
  backups. The viewer implementation and all family YAML remain unchanged.
- Ordinary frozen installation passes with the final supply-chain policies.
  The exact first-party release-age exception is limited to `0.5.0`; provenance
  enforcement stays enabled. Removed the PhantomJS build permission and narrowed
  the semver provenance exception to Babel's still-required `6.3.1`.
- Lock comparison: 18 added package records, 137 removed legacy records, no
  changes to retained package/snapshot blocks or unrelated importers, and the
  bootstrap lock document preserved. No legacy Kingraph/PhantomJS stack remains.
- Final `pnpm audit --json`: zero reported vulnerabilities in every severity
  category. This supersedes the earlier security pass's deferred Kingraph
  findings; it is not a claim that all possible supply-chain risks are absent.
- Site typecheck passes; all 40 site tests pass with zero skips. Changed config
  and declaration Biome checks, an unignored native manifest parse/format check,
  and rumdl checks for all eleven pages pass.
- The normal site build completes with 1,340 pages. All eleven output islands
  reference emitted SVGs with matching positive viewBox dimensions and family
  labels. All eleven pages and eleven SVG assets return HTTP 200 from preview.
- Production-browser DOM verification decoded all eleven SVGs successfully.
  Savoy's image loaded at nonzero dimensions; its modal opened/closed, a wheel
  event changed scale from 1 to 1.125, and mouse events panned the diagram.
  These checks used DOM-dispatched events, not trusted native pointer input.
- Development-mode Travertine returned HTTP 200 and loaded the plugin's SVG data
  URL at positive intrinsic dimensions, without an Astro error overlay.
- Independent bounded specification/security/quality review returned APPROVED
  with no findings. All 27 frozen implementation entries remained unchanged
  through review. The reviewer inspected source and native receipts; the parent
  completed the separate browser gate and audited the read-only commands.

### Verification limits and preserved baseline warnings

T3 snapshots timed out twice after 15 seconds and its native click also timed
out. Standalone Playwright was not connected, and browser-use rejected loopback
navigation. Working T3 DOM evaluation supplied real-browser image decoding,
layout and programmatic interaction evidence; no screenshot or pixel-fidelity
comparison is claimed. A development navigation timeout was reconciled by the
actual loaded URL, decoded image, and an independent successful HTTP request.

The unchanged viewer emits React development warnings for hyphenated SVG
attributes. The existing calendar predev step used its configured fallback after
a service timeout. Neither was changed as part of the Kingraph migration.
Generic plugin HMR/error-path coverage remains upstream rather than duplicated
here. No commits, pushes, PRs, publication, or deployment were performed.
