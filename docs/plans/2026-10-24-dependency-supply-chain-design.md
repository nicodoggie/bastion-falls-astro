# Dependency and supply-chain remediation

## Goal

Reduce known dependency vulnerabilities and dependency-ingestion risk across the
Bastion Falls pnpm workspace without a blanket major-version upgrade or unrelated
application changes. Preserve existing site, CLI, package, and bot behavior.

## Scope and ownership

Include the root, Astro site, CLI, owned workspace packages, pnpm install policy,
and the three existing GitHub Actions workflows. Review development dependencies
as well as production dependencies: build tools execute with developer or CI
permissions even when they are not shipped to the browser.

Exclude `5etools-src`, machine-wide tool installations, secrets, deployments,
publication, and unrelated content or application refactors. Preserve all existing
uncommitted changes, including the current manifest and lockfile edits. Do not
commit or push as part of this design handoff.

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

## Observed baseline

The initial `pnpm audit --json` reported 128 advisory records across 42 package
names: 5 critical, 60 high, 51 moderate, and 12 low. These records represent 114
distinct advisory URLs; records and advisory identities are not interchangeable.
Presence in the dependency graph does not establish runtime exploitability or
compromise.

Programmatic path classification found 15 records whose reported paths are
exclusively through Kingraph, 2 records shared between Kingraph and other paths,
and 111 records with no Kingraph path. This is an initial triage boundary, not a
promise that every non-Kingraph record has an available compatible remediation.

The initial audit JSON is retained as task evidence at
`/home/ensu/.hermes/cache/scratch/bastion-dependency-baseline-r9tsz03m/audit.json`.
That scratch location is temporary; the final technical handoff must summarize
remaining findings durably without relying on it.

The install policy already has an explicit build-script allowlist and exact
release-age exceptions. Existing workflows use mutable action references, one
Discord action on `master`, and inconsistent toolchain initialization, including
unversioned Corepack installation.

## Selected approach

Prefer security-first modernization over either audit-only patching or a blanket
latest-version upgrade.

### Dependency remediation

Trace affected dependencies to their direct parents and real consumers. Prefer
supported parent updates, compatible patched releases, and native lockfile
refreshes. Confirm that proposed patched versions exist in the registry. Use
major-version changes only when needed for a concrete remediation and include
the corresponding compatibility proof.

Avoid new persistent overrides unless a supported parent demonstrably excludes
the patched resolution. Any necessary override must be narrowly scoped, explain
why the parent cannot yet supply the fix, and have a removal condition. The
Kingraph exclusion takes precedence over this fallback.

### Install policy

Review actual install-script requirements and retain only justified permissions,
subject to the Kingraph deferral above. Establish an explicit seven-day release
age policy using the installed pnpm version's documented semantics. Keep necessary
exceptions exact and explained, including urgent security patches; do not disable
the policy or broadly exempt a package to make an installation pass.

Review supported native registry/provenance and integrity protections before
adding custom machinery. Preserve frozen-lockfile installation. Do not treat
integrity hashes as evidence that a publisher or package is trustworthy.

### CI trust boundary

Pin third-party actions to verified immutable commit SHAs, with readable release
annotations. Align Node and pnpm selection with the repository's declared pins,
remove redundant bootstrap paths where supported tooling suffices, and avoid
unversioned tool installation. Set explicit minimal workflow permissions and
avoid persisting checkout credentials where later steps do not require them.

Review untrusted checkout or dependency execution relative to credential-bearing
steps. Do not add external reporting services, change repository settings, or
trigger deployment/publication workflows during local verification.

## Verification and acceptance

Use native package-manager, workflow, TypeScript, test-runner, and build evidence.
Do not add bespoke tests for static dependency-version strings or action SHAs.
Add a focused behavior regression only when an actual compatibility repair
changes executable behavior.

At stable dependency batches, verify frozen installation and the affected
packages' existing tests, typechecks, and builds. For site-visible compatibility
changes, inspect a rendered page when static checks cannot establish behavior.
Validate changed workflows with native tooling where available. Run a final
audit and classify remaining findings as Kingraph-deferred, independently
upstream-blocked, or otherwise unresolved with evidence.

A successful pass means non-deferred findings are remediated where supported
versions exist, residual blockers are explicit, install/CI protections are
verified, and affected application behavior still works. It does not mean a
zero-finding audit, proof of no compromise, a deployed release, or closure of
remote security alerts.

## Execution handoff

After review of this design, produce an implementation plan with concrete update
batches and package-specific validation commands. Independent read-only reviews
may cover dependency reachability and CI/install policy, but one owner must
reconcile shared manifest, lockfile, and policy edits. Carry the Kingraph boundary
verbatim into any delegated implementation or review brief.
