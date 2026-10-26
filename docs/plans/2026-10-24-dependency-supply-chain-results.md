# Dependency and supply-chain remediation results

## Status and review target

Implemented locally on `chore/dependency-supply-chain-2026-10-24` in
`/home/ensu/Projects/bastion-falls-astro`. Changes remain uncommitted; nothing was
pushed, published, or deployed. Existing content, skills, submodule state, and the
user's Node/pnpm migration edits were preserved. Node remains 24.22.1 and pnpm
remains 12.15.0.

Independent specification/security/quality review approved the combined candidate.
The initial review requested representative browser math evidence; a focused
re-review accepted that proof without requiring implementation changes. Its frozen
implementation scope is the 18 dependency/policy/workflow paths listed in
`/home/ensu/.hermes/cache/scratch/bf-dependency-remediation-10xuvt5r/review-candidate.json`.
The result document is outside that immutable implementation review scope.

## Audit outcome

| Severity | Initial records | Final records |
| --- | ---: | ---: |
| Critical | 5 | 1 |
| High | 60 | 7 |
| Moderate | 51 | 9 |
| Low | 12 | 0 |
| Total | 128 | 17 |

Every remaining reported dependency path goes through Kingraph. No advisory IDs
were suppressed. The initial 128 records represented 114 advisory URLs; records,
unique advisories, dependency paths, and exploitable application flaws are distinct
quantities. This pass is not a compromise assessment or a claim that each scanner
severity is an exploitable site vulnerability.

## Dependency updates

Used pnpm's recursive compatible-range update with Kingraph explicitly excluded,
under the seven-day release-age policy. Kept the current major lines of Astro,
React, Mermaid, Undici, Vitest, TypeScript, and Zod rather than updating everything
to the latest major. Compatible transitive refreshes addressed the bulk of the
findings, including parser, HTTP, sanitizer, build-tool, and language-server
copies.

The CLI's former `adm-zip` and `esbuild` ranges excluded their patched releases;
raised them to `^0.6.1` and `^0.28.2`. Removed `@types/adm-zip` because adm-zip 0.6.1
ships its own declarations. Archive tests and the CLI build/typecheck pass.
Updated Expressive Code through its maintained 0.44.3 parent release to obtain a
patched selector-parser branch rather than overriding its older parser directly.
The schema source remains pinned to `5etools-utils` 0.17.19: even published 0.17.24
still excludes simple-git 4, and unrelated schema regeneration is not a security
remediation for that tooling dependency.

### Narrow transitive overrides

These are parent-scoped supported ranges, not global exact-version replacements.
Remove each once its parent accepts a patched branch, then resolve and verify
without that entry. Registry metadata for both installed and latest parents was
inspected before introducing the exceptions.

| Parent | Patched dependency range | Why an ordinary refresh was insufficient |
| --- | --- | --- |
| flowbite-react | deepmerge-ts `^8.0.2` | Latest parent 0.12.17 pins 7.1.5. |
| 5etools-utils | simple-git `^4.0.2` | Latest parent 0.17.24 still requires `^3.36.0`. |
| miniflare | undici `^7.30.1` | Current Wrangler/Miniflare releases pin vulnerable 7.29.1. |
| @tailwindcss/typography | postcss-selector-parser `^7.1.6` | Latest parent 0.5.20 pins 6.0.10. |
| mermaid | katex `^0.19.0` | Current compatible 11.x parent requires vulnerable 0.16.x. |
| markmap-lib | katex `^0.19.0` | Latest parent 0.18.12 requires vulnerable 0.16.x. |
| @vscode/markdown-it-katex | katex `^0.19.0` | Latest parent 1.1.2 requires vulnerable 0.16.x. |

KaTeX 0.18.11 was rejected after registry inspection: its maintainer deprecated it
as accidentally introducing breaking changes and recommends 0.19.0. The selected
0.19.0 release satisfies the age policy. Native KaTeX rendering and the actual
Markmap math transformer pass with that version. Flowbite's actual theme resolver
passes a nested theme/class replacement probe with deepmerge-ts 8.0.2. The full
site build exercises the typography and Expressive Code CSS pipelines. The schema
generator consumes schema JSON paths rather than invoking simple-git; its build
and the downstream site build pass. Wrangler's local dry run also passes with the
patched Undici closure. None of these overrides targets Kingraph.

## Install and provenance policy

`pnpm-workspace.yaml` now explicitly declares:

- Seven-day `minimumReleaseAge` (10,080 minutes), with missing publish times rejected.
- `trustPolicy: no-downgrade`, without a blanket age-based exemption.
- `trustLockfile: false`, retaining policy verification for frozen lock entries.
- `blockExoticSubdeps: true`, preserving native restrictions on transitive sources.
- `strictDepBuilds: true`, preserving the existing explicit script allowlist.

The final frozen installation passed native verification of 1,416 lock entries.
No trust-lockfile bypass or checksum-refresh bypass was used. A normal lock-only
install first refused the stale Lefthook 2.2.2 entry; the supported explicit
`pnpm update --workspace-root lefthook@2.2.1 --lockfile-only --ignore-scripts`
replaced it, after which ordinary frozen installation passed.

### Exact release-age exceptions

Removed old release-age exemptions. The remaining exclusions name exact releases:
the Expressive Code 0.44.3 family, needed for its maintained parent security fix,
and fast-uri 3.1.9, the October 19 fix accepted by AJV's existing range. Neither
exception exempts an entire package or disables the age policy. Remove these
entries after their releases have aged through the normal window.

### Existing provenance gaps and rejected new release

The native trust policy compares release chronology, not semver. It flagged five
exact releases already present in the before snapshot: chokidar 4.0.3, semver 5.7.2
and 6.3.1, tailwind-merge 2.6.1, and undici-types 6.21.0. Registry signatures and
release history were inspected; these versions lack stronger provenance evidence
present on an earlier release of their respective package. Narrow version-specific
`trustPolicyExclude` entries preserve existing parent/legacy constraints without
exempting future versions. This is a documented residual trust exception, not
independent proof of publisher identity, provenance validity, or absence of
compromise. Remove an entry when no retained parent requires that release.

The newly selected Lefthook 2.2.2 also lacked provenance after provenance-bearing
2.2.1. Instead of adding a new-release exception, selected and pinned 2.2.1; revisit
that pin when a newer release satisfies the trust policy. The first install, before
this policy was enabled, had already executed 2.2.2's postinstall. Moving back to
2.2.1 does not establish a forensic conclusion about that earlier execution.

Existing `phantomjs-prebuilt` installation permission remains under the explicit
Kingraph deferral. No new dependency script permission was granted. pnpm also
reported an unapproved dotenv agent-skill offer; it was not approved.

Policy reference:
[pnpm dependency resolution settings](https://pnpm.io/settings/dependency-resolution)
and [build settings](https://pnpm.io/settings/build).

## CI trust boundary

All remaining external actions are pinned to verified immutable commits, with
readable `v6` annotations:

- actions/checkout: `d23441a48e516b6c34aea4fa41551a30e30af803`.
- actions/setup-node: `249970729cb0ef3589644e2896645e5dc5ba9c38`.
- pnpm/action-setup: `0977fd99725f1db4007ccb2928dbb4e90d06cc86`.

All three workflows select Node from `package.json`, install the manifest-pinned
pnpm through one setup action, retain frozen installation, and disable persisted
checkout credentials. Deploy workflows explicitly grant only `contents: read`;
publishing retains its existing job-level OIDC provenance permission. Removed
unversioned Corepack installations and redundant bootstrap routes. The pnpm setup
action selects the pinned version but strips the manifest integrity suffix;
this report does not claim that action enforces that exact manifest hash.

The former Discord action interprets commit-derived notification text as Lodash
template source and uses an obsolete container runtime. Replaced it with native
Node `fetch` and `JSON.stringify`, passing metadata as data, disabling Discord
mentions, using a bounded request timeout, and reporting unsuccessful deployments
truthfully. No third-party notification dependency or fixed multiline-output
delimiter remains. Four loopback-only cases exercised literal hostile metadata,
failure status, HTTP rejection, and missing webhook configuration. No real
notification was sent.

Zarifa deployment now invokes its existing workspace `deploy` script directly with
the existing step-scoped credentials. The removed Wrangler action supplied no
consumed outputs and could otherwise fall back to downloading tooling during a
credential-bearing step. The direct route uses the already-installed lockfile
version. Native Wrangler `deploy --dry-run` completed; nothing was deployed.

## Verification

- Frozen dependency installation under the final native policy: passed.
- 11 package build commands: passed, including the 1,340-page Astro build.
- 10 package test commands: 688 tests passed, no reported skipped tests.
- 8 declared package typecheck commands: passed.
- `actionlint` on all three modified workflows: passed.
- Native syntax check and four local notification fixtures: passed.
- Native KaTeX/Markmap rendering and Flowbite theme compatibility probes: passed.
- Wrangler local deployment dry run: passed, no upload/deployment.
- Browser DOM inspection: homepage rendered; Elven Boons page rendered 37 Markmap
  nodes, with no Astro error overlay observed.
- Representative math browser proof: actual compiled Markmap renderer produced
  five legible expressions (superscript, fraction, radical, integral, matrix)
  using KaTeX 0.19.0 HTML and its unchanged advertised 0.16.18 CSS/fonts. Loaded
  fonts, nonzero rendered dimensions, zero math errors, and a directly inspected
  screenshot close the review's original compatibility-evidence gap. T3 screenshot
  timeouts required the browser-use fallback with a self-contained data-URL fixture.
- Markdown checks and task diff whitespace checks: passed before final handoff.

The root test script is an intentional failing placeholder and was not presented
as a suite. An initial multi-package Biome check was blocked by nested-root config
selection. Instead, all 13 changed manifests were parsed and formatted through the
installed native formatter using isolated stdin input; no new format mismatch was
introduced relative to the exact before files. Five manifests retain pre-existing
formatting differences. No unrelated formatter migration or blanket formatting
was performed.

Application test/build evidence precedes the final Lefthook-only tool change and
install-policy/CI edits; no application dependency version changed after those
successful checks. The final install, workflow checks, notification proof, local
Wrangler dry run, and browser inspection cover the subsequently changed surfaces.

## Deferred Kingraph findings

Kingraph remains 0.3.2, with its vulnerable legacy dependency versions retained.
Compatible shared helper packages and peer qualifiers refreshed as part of the
workspace update; no Kingraph-specific override or renderer change was made.
These findings stay visible and are deferred to the separately planned modernized
fork, not dismissed as false positives.

| Package | Resolved versions | Severity | Advisory |
| --- | --- | --- | --- |
| `yargs-parser` | 4.2.1 | moderate | [GHSA-p9pc-299p-vxgp](https://github.com/advisories/GHSA-p9pc-299p-vxgp) |
| `svg2png` | 4.1.1 | moderate | [GHSA-mpp5-2x55-49xw](https://github.com/advisories/GHSA-mpp5-2x55-49xw) |
| `trim-newlines` | 2.0.0 | high | [GHSA-7p7h-4mm5-852v](https://github.com/advisories/GHSA-7p7h-4mm5-852v) |
| `request` | 2.88.2 | moderate | [GHSA-p8p7-x288-28g6](https://github.com/advisories/GHSA-p8p7-x288-28g6) |
| `tough-cookie` | 2.5.0 | moderate | [GHSA-72xf-g2v4-qvf3](https://github.com/advisories/GHSA-72xf-g2v4-qvf3) |
| `form-data` | 2.3.3 | critical | [GHSA-fjxv-7rqg-78g4](https://github.com/advisories/GHSA-fjxv-7rqg-78g4) |
| `js-yaml` | 3.13.1 | moderate | [GHSA-mh29-5h37-fv8m](https://github.com/advisories/GHSA-mh29-5h37-fv8m) |
| `qs` | 6.5.5 | moderate | [GHSA-6rw7-vpxm-498p](https://github.com/advisories/GHSA-6rw7-vpxm-498p) |
| `uuid` | 3.4.0, 9.0.1 | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `form-data` | 2.3.3 | high | [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) |
| `js-yaml` | 3.13.1 | moderate | [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) |
| `js-yaml` | 3.13.1 | high | [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) |
| `js-yaml` | 3.13.1 | high | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) |
| `extract-zip` | 1.7.0 | high | [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) |
| `qs` | 6.5.5 | moderate | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) |
| `extract-zip` | 1.7.0 | high | [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) |
| `js-yaml` | 3.13.1 | high | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |

### Remaining dependency paths

- `astro>kingraph>js-yaml`
- `astro>kingraph>meow>trim-newlines`
- `astro>kingraph>svg2png`
- `astro>kingraph>svg2png>phantomjs-prebuilt>extract-zip`
- `astro>kingraph>svg2png>phantomjs-prebuilt>request`
- `astro>kingraph>svg2png>phantomjs-prebuilt>request>form-data`
- `astro>kingraph>svg2png>phantomjs-prebuilt>request>qs`
- `astro>kingraph>svg2png>phantomjs-prebuilt>request>tough-cookie`
- `astro>kingraph>svg2png>phantomjs-prebuilt>request>uuid`
- `astro>kingraph>svg2png>yargs>yargs-parser`
- `astro>kingraph>uuid`

## Evidence and external limits

Execution logs, before snapshots, registry metadata, raw audit JSON, verification
results, notification fixture receipts, and review identity are retained under
`/home/ensu/.hermes/cache/scratch/bf-dependency-remediation-10xuvt5r`.
This scratch evidence expires; the substantive outcomes and every remaining
advisory are recorded above so the handoff does not depend on scratch retention.

No GitHub workflow, actual Cloudflare deployment, npm publication, or real Discord
message was triggered. Local success does not establish remote runner execution,
deployed remediation, registry publication, or closure of remote alerts. Builds
still execute dependency code on the same runner as later credential-bearing
steps; pinning, script permissions, age, and trust controls reduce risk but do not
provide process isolation. Actual publication also retains the pre-existing
`private: true` package blocker; this pass does not enable publication.

Markmap's pre-existing browser CDN assets remain separate from the local lockfile
and audit. The representative compatibility proof does not make those mutable
runtime URLs immutable or certify every possible math construct. A browser-asset
localization/pinning change is not silently included in this dependency/CI pass.
