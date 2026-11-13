---
name: finishing-a-development-branch
description: Use when finishing verified work and choosing integration or cleanup.
---

# Finishing a Development Branch

Finish the requested integration with evidence, without silently discarding the workspace that produced it.

**Sequence:** recover the approved destination → verify the exact candidate → inspect integration policy → execute the chosen action → verify the landing → propose separately scoped cleanup.

## 1. Recover the requested action

Read the latest user decision and repository guidance before offering choices. If Nico has already asked to push and merge, carry out that selection; do not require another menu or interpret a missing cleanup decision as missing merge authorization. Distinguish local commits, branch publication, remote merge, release/deployment and deletion as separate side-effect classes.

When no destination/action has been chosen, offer concise options appropriate to the actual state: integrate locally, publish a PR, keep the work, or explicitly discard it. Do not offer local merge from an unmanaged detached HEAD without first preserving its exact revision on an authorized ref.

## 2. Freeze identity and verification

Record the absolute working directory, repository top level, Git common directory, branch, HEAD, dirty/index state and destination remote. Inspect `git worktree list --porcelain` before changing branches; the primary checkout or target branch can belong to another session.

Use the repository's declared environment and the personalized `tdd-review-workflow` to choose proportionate verification. Preserve valid earlier receipts on unchanged source; do not replace a missing independent review or real consumer qualification with a broad unrelated test count.

When Nico explicitly accepts a completed build as the merge gate, apply that task-local decision immediately:

1. Update the existing PR's disposition: identify the accepted build/source, the current publication head, and deferred runtime checks. Replace obsolete draft/QA holds rather than leaving contradictory current instructions.
2. Inspect any intervening source delta and run the cheapest meaningful merge-resolution checks. Do not automatically restart an expensive full installer pipeline for a bounded version/metadata resolution when the retained build evidence is explicitly accepted. Keep older build receipts bound to their tested SHA; focused checks do not become a claimed full build of the refreshed combination.
3. Execute the already-authorized push/merge without reopening the deferred QA decision. Pause for a newly failing applicable gate, material source risk or unresolved authority—not merely an unchecked test the operator has accepted deferring.

An accepted/deferred limitation remains documented, not silently fixed or falsely described as passing. When the approved order is remaining dependency retirement followed by combined deliverable qualification, preserve that order across the merge: continue the approved acquisition/staging slices with focused evidence, and reserve the next expensive whole-application/installer run for the integrated candidate. Do not turn each leaf checkpoint into another full build or treat the intermediate merge as completion of the remaining work. Keep the current plan/tracker disposition consistent with that sequencing. Treat build-only acceptance as task-local, not a standing waiver for future runtime or release work.

Inspect the exact candidate range against the fetched destination, then inventory tracked edits and untracked authored files separately. An already-merged branch can still carry substantial uncommitted follow-up work; classify that work into explicit commit allowlists rather than declaring integration complete from ancestry alone. Name excluded drafts and unrelated changes instead of sweeping them into “all changes.” Check each named PR's live state before publication; an already-merged PR requires readback, not another merge attempt.

## 3. Execute the selected integration

### Remote PR

Use `github-pr-workflow` for policy discovery, exact-head publication, review/check gates and merge readback. A generic merge request does not authorize bypassing a newly discovered review rule. Once Nico explicitly approves the scoped bypass, execute it against the unchanged reviewed head without asking again.

A successful push establishes publication, not merge. A requested auto-merge may be unavailable or rejected; read back its actual state before reporting it queued.

### Local integration

Resolve the actual destination branch and its current remote ref. Do not switch or pull a busy/dirty primary checkout merely because it contains the common Git directory. Use an authorized clean integration worktree when necessary, preserve the feature checkout and prefer fast-forward integration when supported by ancestry.

When a concurrent owner is separating unfinished work from the shared checkout:

1. Agree on the exact paths and a pinned committed base before either session changes refs; a moving `HEAD` can silently change the handoff's contents.
2. Have that owner verify copied authored files and useful ignored evidence by hashes. Retain canonical private originals in the primary checkout when custody requires it; branch separation does not require moving the only transcript copy.
3. Require the owner's explicit ready-for-primary-switch acknowledgement after destination verification and removal of only the hash-identical shared draft. A new worktree registration alone does not establish completed custody. Until acknowledgement, perform only independent checks and agreed scoped commits; do not switch the shared branch. Scope this gate to operations that affect the owner's checkout or files: if the primary is already on the requested destination and that owner is no longer running, assess the merge separately. A preserved loose draft absent from both merge trees need not block an otherwise authorized merge; verify its hash before and after, leave it uncommitted, and retain its private evidence. Do not treat a paused handoff as permission to delete the draft or its worktree.

Before staging in a sparse checkout, compare the reviewed path allowlist with the sparsity rules. For authorized authored files outside those rules, use `git add --sparse -- <exact-reviewed-paths>`; do not disable sparsity, materialize unrelated data or use `-f` to bypass ignore policy. Before each scoped commit, compare `git diff --cached --name-status` with its allowlist and verify staged content against the checked candidate. After a failed multi-path `git add`, inspect the index before retrying: eligible paths may already be staged despite the nonzero exit. For an allowlisted tracked file beneath an ignored parent, confirm its index entry with `git ls-files --stage -- <path>` and use `git add -u -- <path>` only if its tracked update still needs staging. Do not force-add an ignored evidence directory to repair a parent-path warning. Chain candidate validation, commit, push and PR creation with `set -e` or explicit success dependencies, because a failed Python validation followed by an independent shell command can otherwise publish the unchanged base branch. Reconcile remote branch/PR state before retrying publication after such a partial failure.

Verify the composed result before an authorized destination push, then compare the remote ref with the expected commit. If reconciliation introduces source changes, rerun the smallest affected gates before publication.

### Keep or discard

For keep, report the retained absolute worktree path, branch and exact revision.

For discard, enumerate the exact checkout, branch refs, unique commits, dirty/untracked content and evidence at risk. Obtain explicit destructive approval before removal. A user's question about whether cleanup is ready is read-only discovery, not discard authorization.

## 4. Verify completion

Verify the requested artifact on the actual destination, not merely somewhere in history: use `git cat-file -e <destination>:<path>` for file presence, `git merge-base --is-ancestor <reviewed-tip> <destination>` for commit containment, and blob/tree comparisons for unchanged content. Report local integration separately from remote publication; a feature-branch commit or a previously merged ancestor does not establish that the new note reached main.

If HEAD or the index changes during preflight, stop the stale mutation and reread branch, status, reflog and ancestry. Another writer may already have landed the requested merge; verify that result rather than replaying the merge or claiming its authorship.

Read back the exact external target after every publication or merge. For a squash merge, verify the PR's merged state and merge commit, fetch the destination and compare the reviewed tree with the merge commit. Preserve tests on identical trees despite changed commit metadata. Investigate unexpected differences; if the destination advanced concurrently, prove the merge is contained and report later changes separately.

After verified landing, close an explicitly authorized integration issue as completed integration and synchronize its owning Project status. Distinguish the issue's delivery scope from broader product QA: retain the existing QA tracker and deferred checks without marking them passed or keeping completed integration indefinitely open. Read back both issue state and board status; a merge or an already-closed response does not establish both.

Report what actually completed, the authoritative commit/URL, remaining holds and the actual worktree used. Keep implementation, qualification, release and cleanup states distinct.

## 5. Audit cleanup separately

Load `auditing-development-disk-cleanup` for readiness discovery and `git-change-grouping` for preservation/reconciliation of dirty leftovers.

- Never infer ownership or deletion authority from a `.worktrees/` directory name; harnesses, users and other agents use the same convention.
- Separate branch integration from checkout disposability. An integrated branch may have a dirty worktree, and a clean worktree may contain useful ignored evidence or an installed environment used elsewhere.
- Inventory ancestry, patch equivalence, dirty/untracked/ignored content, retained refs, runtime dependencies and harness ownership before recommending retirement. Preserve unresolved or unique content.
- Do not remove a feature worktree or delete a branch merely because its merge succeeded. Carry explicit cleanup approval only through its named allowlist. Treat “clean up on closeout” as an ordering constraint: finish authorized integration first; if publication authority is still unresolved, retain the implementation workspace and branch. A verified patch archive preserves bytes but is not integration or a reason to advance closeout.
- When removal is authorized, recheck candidate identity/status, move the shell outside the target and use ordinary `git worktree remove`; do not use force removal to hide a dirty-tree failure. Verify directory and registry absence afterward.
- Treat branch deletion and registry pruning as separate scoped mutations. Do not run a blanket prune or delete unrelated local/remote refs as automatic closeout.

## Stop conditions

Stop for a changed reviewed head, a newly failing relevant gate, an unresolved policy requirement, conflicting concurrent ownership or unapproved destructive scope. Preserve completed work and state the smallest missing decision. Do not keep asking for an approval already granted, or claim that a retained worktree means an otherwise verified merge is unfinished.
