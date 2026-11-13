---
name: using-git-worktrees
description: Use when selecting a task branch or Git worktree.
---

# Using Git Worktrees

Choose branch ownership separately from filesystem isolation. For serial work, recommend a named task branch in an available existing checkout; a separate worktree is an explicit isolation choice, not an automatic consequence of a new task or PR. Follow repository-specific workspace guidance and explicit user choices. Keep Git workspace identity separate from the editor/thread binding.

## 1. Establish the target before creation

Record the absolute working directory, repository top level, Git common directory, branch, HEAD and dirty state:

```sh
pwd
git rev-parse --show-toplevel
git rev-parse --path-format=absolute --git-dir
git rev-parse --path-format=absolute --git-common-dir
git rev-parse --show-superproject-working-tree
git branch --show-current
git rev-parse HEAD
git status --short
git worktree list --porcelain
```

A different Git directory and common directory indicates linked storage only after ruling out a submodule. Resume an existing branch/checkout when it already owns this task; do not create a duplicate or continue another task's unfinished work. Check active builds and checkout ownership before any branch switch, because changing source under a running build invalidates its inputs. Resolve the canonical repository before creating another worktree so a linked checkout does not acquire nested worktrees.

Read repository placement and setup guidance. An explicit request for a local worktree supplies creation authority; do not ask for it again. Preserve separate commit/publication boundaries. When the user requests local-only investigation without issues or PRs, keep the work and evidence local rather than adding external tracking as a prerequisite.

Choose an explicit base revision. Do not silently fetch or substitute the remote default branch for the inspected base. Preserve relevant uncommitted task context before a host handoff: new worktrees start from committed state. Copy only task-owned, non-secret documents or edits that belong in the new checkout; leave originals and unrelated dirty work intact.

## 2. Choose branch-only or separate-worktree setup

Before implementation edits, ask whether to create a separate worktree unless the operator has already chosen or the repository explicitly requires isolation. Recommend a named task branch in the existing checkout for available serial work, and a separate worktree for concurrent work or conflicting unfinished changes. Read-only investigation needs neither. A default recommendation does not replace the operator's choice.

When moving an owned draft off a concurrently owned primary checkout, separate only that draft and its approved evidence closure; a new task branch is not permission to switch the shared primary branch or carry everyone else's dirty files. Use `references/owned-draft-isolation.md` for the staged transfer and release acknowledgement.

Apply the same repository branch-naming guidance in either case. Name the branch for the actual change category: use `infra/` for new infrastructure or deployment policy where the repository permits it; reserve `fix/` for correcting an established defect. A configuration change is not automatically a bug fix. If the user corrects an unpublished branch's category, verify the current branch and target-name availability, rename it with `git branch -m`, and confirm HEAD and dirty files are preserved; do not recreate the checkout, reset files or rewrite commits merely to change the label. Declining a worktree does not mean editing on `main`: create the task branch at the agreed base with `git switch -c <branch> <base>`, or resume the branch already owning the task. Do not invent issue numbers or duplicate tracking to obtain a branch name.

A branch switch retains ignored checkout-local directories such as `.conan`; no cache copy is needed. Preserve useful compiler intermediates too, but let the native dependency/build tools decide whether retained state still matches the new inputs. Do not promise warm builds merely because the directory survived.

For branch-only setup, verify root/common directory, branch, HEAD and dirty state, then continue at preparation. Do not run worktree-creation steps.

## 3. Choose a placement-compatible isolation mechanism

For an approved separate worktree, inspect the native tool's current status, destination/base controls, setup behavior and session-handoff behavior.

- Use it when it can satisfy the required repository, base and placement.
- If it cannot express a repository-mandated destination, use an authorized Git worktree operation at that destination. Do not invent unsupported parameters or alter global host preferences merely to force placement.
- If the harness explicitly requires its native isolation route, report a placement conflict rather than bypassing that requirement.
- Disable optional setup for read-only research or documentation work; creation should not accidentally run installs, builds or account operations.
- If a native handoff ends the session, prepare the transfer inventory and executable continuation before invoking it. On resumption, inspect actual files and receipts: a recorded branch move or queued continuation proves neither that the continuation ran nor that the draft/evidence transfer completed. Finish and verify the owned transfer before claiming isolation complete or releasing another owner's primary checkout.

A shell-created worktree does not move the user's editor or rebind a host-managed thread. Report that distinction and use the absolute target path for subsequent tools.

## 4. Create and verify the worktree

Use the declared directory preference. Otherwise prefer an existing project-local `.worktrees/`, then `worktrees/`, and default to `.worktrees/` when neither exists. Check exclusion before creating a project-local tree:

```sh
git -C "$canonical" check-ignore -v "$relative_worktree_directory"
```

If not ignored, make only the authorized ignore change and recheck. Worktree creation does not itself authorize committing `.gitignore`.

After confirming the branch and destination do not already exist:

```sh
git -C "$canonical" worktree add -b "$branch" "$path" "$base"
```

Read back the new checkout's absolute root, common directory, branch, HEAD and dirty state. Bind all later reads, edits, builds and evidence to that exact checkout.

For a newly created `--no-checkout` worktree, sparse-checkout patterns alone can leave its index empty: every tracked file appears as a staged deletion while the directory contains only `.git`. After establishing the intended sparse exclusions and verifying that exact fresh/empty precondition, populate it with native `git read-tree -mu HEAD`, then check status again. Do not apply that initialization as generic recovery to an existing dirty worktree. A denied creation/edit is not permission to retry through another write tool or silently work in the dirty primary checkout; preserve state and resolve the denied operation before continuing that path.

## 5. Prepare only what the task needs

Inspect the selected component's manifest, pinned runtime/package manager and documented commands before setup. Do not run `npm install`, a full build or every repository's test suite merely because a manifest exists. Reuse prepared tooling, install only needed dependencies within the approved scope, and keep unrelated package managers, caches and global configuration unchanged.

For a new worktree, ask separately whether to seed relevant build caches. Recommend skipping native-cache setup for docs/read-only/UI-only tasks that do not use it; creation approval does not authorize a large copy. Identify the intended target, idle donor, effective cache home, selected package footprint and available disk space before proposing transfer. Account for the retained donor, temporary archive, restored copies and later build outputs; compressed size is not restored size. Avoid whole-cache copies and automatic eviction.

For Conan, follow the repository-owned native graph/package-list and `cache save` → `cache restore` procedure into independently writable storage. Inspect effective home overrides in both checkouts: different directory spellings, symlinks or junctions can still address one live cache. Do not transfer whole-home credentials/configuration or editable registrations. Package seeding does not copy checkout-associated compiler intermediates or warm `--local` compilation. Keep cache operations idle/serialized and distinguish verified restoration from cache hits observed through the intended consumer.

Before expensive Windows setup, assess checkout/cache/output path depth using the repository's known constraints. A short alias or long-path OS setting does not prove child-tool compatibility; preserve existing locations and deferred repair scope.

For remote native qualification, keep the local source worktree, remote source stage and test-output directory as distinct identities. Export the exact required source closure and verify the transfer; a Windows archive stage is not a Git worktree. Include intended dirty candidate files explicitly rather than assuming `git archive HEAD` contains them.

## 6. Establish the relevant baseline

Run the cheapest meaningful checks for the planned changes. Documentation needs source/link/lint checks; native behavior needs the actual target runtime. Inspect runner side effects and direct outputs to an owned directory before launch.

When the goal is preserving paid build work across tasks, verify that transition rather than two unrelated warm builds: either change task branches in the same checkout and exercise retained state, or seed a new independent home from a warm donor and observe matching packages reused by the ordinary recipient build. Separate package reuse, editable/compiler warmness, disk/transfer cost and Windows path qualification. A small native archive roundtrip proves that mechanism, not end-to-end developer workflow readiness; guidance edits alone do not implement automatic seeding.

Record pre-existing failures without changing assertions or production code to manufacture a clean baseline. In an approved data-gathering experiment, retain each failure and continue independent safe probes; ask only when proceeding would change the agreed scope or rely on an unresolved prerequisite. Do not present a partial baseline as a passing full suite.

## Handoff

Report:

- actual checkout path, branch and base, and whether setup reused a checkout or created a worktree;
- cache retention/seeding choice, observed reuse and remaining first-build costs;
- whether the editor/thread binding moved;
- checks run, exact outcomes and unexercised boundaries;
- retained evidence and any approval blocker;
- local-only, committed and published state separately.

Do not delete worktrees, branches or unique evidence as incidental cleanup. Propose cleanup only after verified closeout and within the applicable approval.
