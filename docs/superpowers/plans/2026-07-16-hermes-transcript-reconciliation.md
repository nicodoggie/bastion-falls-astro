# Hermes Transcript Reconciliation Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED-GREEN-REFACTOR. Do not commit unless Nico
> asks.

**Goal:** Add configurable Hermes evidence review between Codex correction and note generation,
preserve its artifacts, and include them in transcript archives.

**Architecture:** Keep the Codex correction path intact. Resolve a generic review provider from CLI
and project config, then invoke a bounded Hermes process per corrected chunk. Parse its tagged
response, write separate reconciled artifacts, and route downstream summarization to them. Archive
only the top-level provenance artifacts.

**Tech Stack:** TypeScript 6, Node.js test runner, Stricli, Zod, Hermes CLI, pnpm.

---

## Task 1: Resolve Review Configuration

**Objective:** Resolve generic review provider and Hermes profile with CLI-over-config precedence.

**Files:**

- Create: `cli/src/commands/transcribe/reviewSettings.ts`
- Create: `cli/src/commands/transcribe/reviewSettings.test.ts`
- Modify: `cli/src/commands/transcribe/command.ts`

**Steps:**

1. Write failing tests for provider and profile precedence, accepted values, malformed config, and
   unsupported providers.
1. Run `pnpm -F @bastion-falls/cli test -- reviewSettings.test.ts` and confirm RED.
1. Implement types, parsers, and `resolveReviewSettings`.
1. Add `--review`, `--hermes-profile`, and `--hermes-max-turns` flags.
1. Re-run focused tests and confirm GREEN.

## Task 2: Implement the Hermes Reconciliation Core

**Objective:** Build prompts and arguments, parse tagged output, and reconcile resumable chunks.

**Files:**

- Create: `cli/src/commands/transcribe/hermesReview.ts`
- Create: `cli/src/commands/transcribe/hermesReview.test.ts`
- Reuse: `cli/src/commands/transcribe/process.ts`
- Reuse helpers from: `cli/src/commands/transcribe/codex.ts`

**Steps:**

1. Write failing tests for output directories, prompt contents, CLI arguments, response parsing,
   natural joins, resume, force, and invalid-response diagnostics.
1. Run the focused test file and confirm RED.
1. Implement `HermesReviewOptions` with an injected command runner.
1. Invoke Hermes in quiet `source=tool` mode with file tools, Bastion skills, and bounded turns.
1. Write per-chunk and joined reconciled transcript and review-note artifacts.
1. Re-run focused tests and confirm GREEN.

## Task 3: Integrate Reconciliation Into Transcription

**Objective:** Run Hermes after Codex and route notes generation to reconciled artifacts.

**Files:**

- Modify: `cli/src/commands/transcribe/command.ts`
- Modify: `cli/src/commands/transcribe/checkpoint.ts`
- Modify: `cli/src/commands/transcribe/checkpoint.test.ts`
- Add focused command/helper tests if required.

**Steps:**

1. Write failing checkpoint tests for review provider, reconciled paths, final downstream paths, and
   old-checkpoint compatibility.
1. Run checkpoint tests and confirm RED.
1. Extend the correction checkpoint schema compatibly.
1. Resolve review settings from `getTranscribeConfig()` and flags.
1. Run reconciliation after Codex when the provider is `hermes`.
1. Route both note backends to reconciled transcript and Hermes note paths.
1. Preserve the existing path exactly when the provider is `off`.
1. Run focused tests and confirm GREEN.

## Task 4: Preserve Artifacts in Archives

**Objective:** Add provenance files to compressed and unpacked transcript archives.

**Files:**

- Modify: `cli/src/commands/transcribe/archive/plan.ts`
- Modify: `cli/src/commands/transcribe/archive/plan.test.ts`

**Steps:**

1. Extend the failing archive expectation with optional `correction_notes.md`,
   `reconciled_transcript.md`, and `hermes_review_notes.md`.
1. Run archive-plan tests and confirm RED.
1. Add optional copies while keeping `raw_transcript.md` required.
1. Run archive tests and confirm GREEN.

## Task 5: Enable Bastion Falls Configuration

**Objective:** Make Hermes review the project default while preserving a CLI escape hatch.

**Files:**

- Modify: `astro/.bfcli.yml`

**Steps:**

1. Add `transcribe.review.provider: hermes`.
1. Add `transcribe.review.hermes.profile: default`.
1. Parse the YAML with `js-yaml`.
1. Verify command help shows all review flags.

## Task 6: Verify Code and Run an Isolated Smoke Test

**Objective:** Prove unit behavior and a fake-Hermes path before live model use.

**Steps:**

1. Run `pnpm -F @bastion-falls/cli test`.
1. Run `pnpm -F @bastion-falls/cli typecheck`.
1. Run `pnpm -F @bastion-falls/cli build`.
1. Verify help for `--review`, `--hermes-profile`, and `--hermes-max-turns`.
1. Run a fake-Hermes smoke fixture and inspect all generated artifacts.
1. Run `git diff --check` on touched files.

## Task 7: Replay July 12 Safely

**Objective:** Exercise production review against known difficult chunks without overwriting source
artifacts.

**Inputs:**

- `astro/.bf-transcripts/session-2026-07-12/raw_transcription/`
- `astro/.bf-transcripts/session-2026-07-12/corrected_transcription/`
- `astro/.bf-transcripts/session-2026-07-12/correction_notes_chunks/`

**Steps:**

1. Select a bounded set of chunks containing known benchmark cases.
1. Run Hermes review into `astro/.bf-transcripts/session-2026-07-12b`.
1. Confirm source July 12 artifacts and the authored note are unchanged.
1. Compare Illegally Bear, Luana/Cinna Moan, Marcus Parnassus, Maiden's Field, and Oren Bell.
1. Record runtime, failures, unsupported changes, preserved ambiguity, and remaining questions.
1. Do not promote experimental output automatically.
