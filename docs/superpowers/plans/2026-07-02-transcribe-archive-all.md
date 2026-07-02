# Transcribe Archive All Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--all` to `bfcli transcribe archive` so it archives every immediate session directory in `transcribe.transcribeDir`.

**Architecture:** Keep the current single-session archive path, extract it into a reusable helper, and add a sequential bulk orchestrator around it. Bulk mode lists immediate directories, skips existing outputs unless `--force`, continues after per-session failures, prints a summary, and exits non-zero only when failures occurred.

**Tech Stack:** TypeScript ESM, Stricli, Node filesystem APIs, existing archive modules/tests.

## Global Constraints

- Command is `bfcli transcribe archive`.
- `--all` archives every immediate child directory of `transcribeDir`.
- `--all` cannot be combined with a positional session argument.
- Existing outputs in bulk mode are skipped unless `--force` is enabled.
- Bulk mode continues after failures and exits non-zero if any session failed.
- Single-session mode keeps existing behavior: existing destination without `--force` is an error.
- Bulk mode runs sequentially.
- Tests use `node:test` + `node:assert/strict`.

---

### Task 1: Add Bulk Helper Tests and Implementation

**Files:**
- Modify: `cli/src/commands/transcribe/archive/impl.ts`
- Test: `cli/src/commands/transcribe/archive/impl.test.ts`

**Interfaces:**
- Produces `formatArchiveSummary(results: ArchiveAllResult[]): string`.
- Produces `isExistingOutputSkip(options: { all: boolean; force?: boolean; destinationExists: boolean }): boolean`.

- [ ] **Step 1: Write failing tests**

Create `cli/src/commands/transcribe/archive/impl.test.ts` with tests for `isExistingOutputSkip` and `formatArchiveSummary`.

- [ ] **Step 2: Run red test**

Run: `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/impl.test.ts`
Expected: fail because exported helpers do not exist.

- [ ] **Step 3: Implement helpers**

Add exported helper types/functions to `impl.ts` without changing runtime behavior yet.

- [ ] **Step 4: Run green test**

Run: `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/impl.test.ts`
Expected: pass.

---

### Task 2: Add `--all` CLI Behavior

**Files:**
- Modify: `cli/src/commands/transcribe/archive/command.ts`
- Modify: `cli/src/commands/transcribe/archive/impl.ts`

**Interfaces:**
- `ArchiveFlags` gains `all?: boolean`.
- Positional session becomes optional.

- [ ] **Step 1: Add `all` flag to command**

Add a boolean `all` flag and make the positional session optional.

- [ ] **Step 2: Refactor single-session logic**

Extract existing archive body into `archiveSession(...)`.

- [ ] **Step 3: Implement bulk mode**

If `flags.all`, list immediate directories in `settings.transcribeDir`, skip existing outputs unless `--force`, continue failures, print summary, and set `process.exitCode = 1` if any failed.

- [ ] **Step 4: Validate**

Run:
- `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/impl.test.ts`
- `pnpm test`
- `pnpm exec tsc -p src/tsconfig.json && pnpm build`
- `node dist/cli.js transcribe archive --help`

Expected: tests/build pass; help shows `--all` and optional session.

---

## Self-Review

Spec coverage: covers all requested `--all` behavior, skip semantics, failure continuation, summary, and existing single-session behavior.
Placeholder scan: no placeholders.
Type consistency: `ArchiveFlags.all`, helper names, and result types are consistent.
