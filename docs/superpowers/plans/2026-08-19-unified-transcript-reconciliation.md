# Unified Transcript Reconciliation Implementation Plan

> **For Hermes:** Use `software-development/subagent-driven-development` to implement this plan
> task-by-task. Follow `development/tdd-review-workflow`: focused RED→GREEN for executable
> contracts, one stable CLI suite before final review, and fresh immutable-input receipts around
> live trials. Do not commit or push unless Nico asks.

**Goal:** Replace the multi-call correction/review/summary-cleanup path for new transcript runs with
one evidence-aware, structured reconciliation call per owned logical chunk, then consume those
artifacts through provenance-preserving summaries, public projection, and isolated August 15
benchmark trials.

**Architecture:** Add a strict reconciliation domain module that validates readable structure
independently from summary-safe wording, a deterministic evidence-packet/cache-identity builder, and
an injected Hermes runner that atomically persists one canonical JSON file per logical chunk plus
three joined Markdown derivatives. Integrate the new stage compatibly into the existing
pipeline/checkpoint while retaining historical readers, then add structured chunk/rolling summaries,
structured public rendering, and a trial-only benchmark harness that reads canonical August 15
evidence without writing beneath its source root.

**Tech Stack:** TypeScript 6, Node test runner, Zod 4, Stricli, Node crypto/fs, Hermes CLI, Codex
CLI, pnpm.

**Approved design:** `docs/superpowers/specs/2026-08-19-unified-transcript-reconciliation-design.md`

**Target worktree:**
`/home/ensu/Projects/bastion-falls-astro/.worktrees/unified-transcript-reconciliation`

**Immutable input root:**
`/home/ensu/Projects/bastion-falls-astro/astro/.bf-transcripts/session-2026-08-15`

**Trial root:**
`/home/ensu/Projects/bastion-falls-astro/astro/.bf-transcripts/.trials/session-2026-08-15-unified-reconciliation`

**Changed-path boundary:** `cli/src/commands/transcribe/**`, `astro/.bfcli.yml`, `AGENTS.md`, this
plan, and ignored trial outputs only. Do not modify any file beneath the immutable input root or
authored campaign notes during benchmark execution.

**Fresh-context delegation rule:** Implementers and reviewers do not inherit the parent session's
memory. Every delegation prompt must independently include the absolute worktree, exact task file
allowlist, forbidden paths and side effects, evidence-authority order, immutable input and isolated
trial roots, no-commit/no-push policy, focused commands, and the applicable canonical design
section. Reviewers receive the canonical contract independently of the implementer packet; a link
to this plan or a summary alone is insufficient.

**Evidence authority:** Original audio and pass-keyed STT/alignment artifacts outrank model output.
The caller supplies the authoritative owned event universe; neither a reconciliation response nor
its reviewer may redefine that universe. Readable reconciliation is a review convenience,
summary-safe text is model compatibility only, and neither can silently supersede raw evidence.

---

## Task 1: Define the strict reconciliation contract and hard validator

**Objective:** Represent readable blocks, structurally paired summary-safe wording, evidence
accounting, material corrections, attribution, review status, and summary-safety state without
losing an otherwise valid readable reconciliation when only safe wording fails.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliation.ts`
- Create: `cli/src/commands/transcribe/reconciliation.test.ts`

**Steps:**

1. Write one compact fixture builder and focused tests for strict valid parsing; unknown keys;
   duplicate block IDs; empty rendered tiers; unknown/duplicate/missing event accounting;
   out-of-window/source-unsupported timestamps; permitted overlap; reordered non-overlap; omission
   reasons and source snapshots; material-correction evidence; confidence/basis requirements; exact
   readable/summary block correspondence; expected-character-only suspicion; and
   readable-valid/summary-pending results.
1. Run
   `pnpm -F @bastion-falls/cli exec node --import tsx --test src/commands/transcribe/reconciliation.test.ts`
   and witness behavioral RED from the missing module.
1. Export strict Zod schemas/types and the stable boundaries `parseReconciliationResponse`,
   `validateReconciliation`, `parseCanonicalReconciliation`, and `deriveReconciliationStatus`.
1. Keep hard readable/evidence errors separate from summary-safe errors. Hard errors reject
   canonical persistence; summary-safe errors produce `summarySafety.status: "pending"` while
   retaining valid readable blocks and review metadata.
1. Re-run the focused test and `pnpm -F @bastion-falls/cli typecheck` for GREEN.

### Task 2: Build deterministic evidence packets, hashes, and renderers

**Objective:** Assign stable owned event IDs, include bounded neighbor/channel/glossary/rule/session
context, derive cache identity, and render private, summary-safe, review-queue, and public
projections deterministically.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationEvidence.ts`
- Create: `cli/src/commands/transcribe/reconciliationEvidence.test.ts`
- Create: `cli/src/commands/transcribe/reconciliationRender.ts`
- Create: `cli/src/commands/transcribe/reconciliationRender.test.ts`
- Reuse: `cli/src/commands/transcribe/alignment.ts`
- Reuse: `cli/src/commands/transcribe/channelMap.ts`
- Reuse: `cli/src/commands/transcribe/types.ts`

**Steps:**

1. Write RED tests proving stable `session_NNN:event_NNNN` IDs; exact owned-window selection;
   previous-readable tail and next-alignment head as context-only;
   alternatives/energy/physical-speaker preservation; sensitivity to source/alignment, neighbor,
   channel-map, glossary, correction-rule, prompt/provider/profile, campaign/date, and
   repository-evidence hashes; and no sensitivity to archive-only redactions.
1. Add renderer RED tests for natural multi-fragment blocks, genuine overlap as separate lines,
   summary tier structural identity, durable flagged review entries, private physical labels, public
   physical-name removal, visible probable confidence, unknown fallback labels, and confidence
   legend.
1. Implement stable canonical JSON hashing with SHA-256 and explicit version constants. Hash dirty
   authored evidence by supplied content/revision inputs; do not shell out from the pure builder.
1. Implement `renderPrivateReconciliation`, `renderSummaryReconciliation`,
   `renderReconciliationReviewQueue`, and `renderPublicReconciliation` from canonical JSON only.
1. Run both focused tests and typecheck for GREEN.

### Task 3: Implement the unified Hermes reconciliation runner and transactional lifecycle

**Objective:** Invoke Hermes once per ordinary logical chunk, validate complete structured output,
atomically persist canonical JSON, run summary-safe fallback only when required, and resume only
cache-identical valid chunks.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationRunner.ts`
- Create: `cli/src/commands/transcribe/reconciliationRunner.test.ts`
- Modify: `cli/src/commands/transcribe/process.ts` only if the established command-runner type needs
  reuse

**Steps:**

1. Write RED tests for prompt ownership/context boundaries, strict JSON-only response, Hermes
   argument construction, one ordinary invocation, raw diagnostic preservation, no canonical write
   on malformed/hard-invalid output, atomic artifact publication, joined derivative rendering,
   cache-identical zero-call resume, corrupt/stale repair from the first invalid chunk, and summary
   fallback only for pending safe text.
1. Add one filesystem lifecycle test covering interruption before rename, stale temporary bytes,
   repair, resume, and checkpoint callback ordering.
1. Implement injected `invokeReconciliation` and `sanitizeSummarySafe` seams. Default Hermes
   invocation remains read-only and bounded; neighboring events are marked context-only and output
   ownership is explicit.
1. Persist `reconciliation/session_NNN.json`; render only `reconciled_transcript.md`,
   `summary_transcript.md`, and `reconciliation_review_queue.md`; keep raw malformed responses
   beneath one diagnostics directory.
1. Advance the supplied checkpoint callback only after rereading and validating the canonical
   artifact.
1. Run focused GREEN and typecheck.

### Task 4: Add structured chunk-summary plus rolling-context responses

**Objective:** Collapse each chunk-summary and rolling-context pair into one structured inference
response whose claims cite reconciliation block IDs and whose review dispositions preserve original
flags.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationSummary.ts`
- Create: `cli/src/commands/transcribe/reconciliationSummary.test.ts`
- Modify: `cli/src/commands/transcribe/codex.ts`

**Steps:**

1. Write RED tests for strict chunk response parsing, claim-to-block provenance, unresolved hooks,
   bounded dispositions, next rolling context, unknown block rejection, and one model call per
   summary chunk rather than separate summary/context calls.
1. Define strict schemas for chunk, scene, and session summary artifacts under
   `summarization/chunks`, `summarization/scenes`, and `summarization/session.json`.
1. Implement one structured Codex chunk prompt/response, deterministic validation against canonical
   reconciliation blocks, structured scene/final provenance, and MDX rendering from `session.json`.
1. Keep historical Markdown summarization available only for sessions without reconciliation JSON or
   when the unified path is disabled.
1. Run focused GREEN, existing `codex.test.ts`, and typecheck.

### Task 5: Migrate checkpoint and stage semantics compatibly

**Objective:** Record the canonical reconciliation provider/paths/cache identity and expose
`reconciliation` as the new stop boundary while accepting version-2 historical checkpoints.

**Files:**

- Modify: `cli/src/commands/transcribe/checkpoint.ts`
- Modify: `cli/src/commands/transcribe/checkpoint.test.ts`
- Modify: `cli/src/commands/transcribe/pipeline.ts`
- Modify: `cli/src/commands/transcribe/pipeline.test.ts`

**Steps:**

1. Write RED checkpoint tests for version 3, reconciliation metadata, canonical
   paths/provider/prompt/schema versions, completed chunk identities, summary-safety pending/bypass
   state, incompatible shapes, and explicit version-2 migration.
1. Write RED pipeline tests for `--stop-after reconciliation`, the `correction-review` compatibility
   alias, hard-invalid blocking before notes, `needs_review` nonblocking flow, historical/disabled
   compatibility, and downstream invalidation when reconciliation identity changes.
1. Implement an explicit version-2-to-version-3 parser migration rather than casting. Keep
   historical correction metadata readable in a compatibility field.
1. Rename internal stage semantics to reconciliation while preserving old CLI/checkpoint readers
   where practical.
1. Run checkpoint/pipeline focused GREEN and typecheck.

### Task 6: Integrate unified reconciliation into the transcribe CLI

**Objective:** Make the approved single-chunk unified path the configured production default without
running Codex literal correction, rolling correction context, correction notes, separate Hermes
review, or summary cleanup for new runs.

**Files:**

- Modify: `cli/src/commands/transcribe/command.ts`
- Modify: `cli/src/commands/transcribe/reviewSettings.ts`
- Modify: `cli/src/commands/transcribe/reviewSettings.test.ts`
- Modify: `astro/.bfcli.yml`
- Retain: `cli/src/commands/transcribe/hermesReview.ts` for historical compatibility

**Steps:**

1. Write RED settings and command-surface tests for extensible `reconciliation.provider`,
   CLI-over-config precedence, single-chunk default, explicit legacy/off behavior, and
   reconciliation/help aliases.
1. Route the unified path directly from alignment evidence into `runUnifiedReconciliation`; do not
   call `runCodexCorrection`, `runHermesTranscriptReview`, or `runCodexSummaryCleanup` on that path.
1. Route notes to canonical reconciliation JSON and `reconciliationSummary`; retain legacy
   Codex/Ollama paths for historical sessions lacking canonical JSON or explicit legacy mode.
1. Set `astro/.bfcli.yml` to the new provider shape while accepting the old `review` config as a
   migration alias.
1. Verify `pnpm bfcli transcribe --help` and stop-stage help expose `reconciliation` and the
   compatibility alias.
1. Run focused settings/command tests, typecheck, and build.

### Task 7: Project structured reconciliation through the public archive boundary

**Objective:** Archive readable reconciliation rather than summary-safe wording, apply reviewed
redactions, strip physical identities, preserve overlap, and expose character confidence visibly.

**Files:**

- Modify: `cli/src/commands/transcribe/archive/plan.ts`
- Modify: `cli/src/commands/transcribe/archive/plan.test.ts`
- Modify: `cli/src/commands/transcribe/archive/impl.ts`
- Expand: `cli/src/commands/transcribe/archive/impl.test.ts`
- Modify: `cli/src/commands/transcribe/archive/transcriptRedaction.ts` only if structured rendered
  lines require a narrow parser extension

**Steps:**

1. Write RED archive tests requiring canonical `reconciliation/` JSON provenance, readable public
   projection, confidence legend, no physical speaker labels, redaction application after
   projection, no use of `summary_transcript.md`, and atomic failure on unsafe output.
1. Include canonical reconciliation JSON as private provenance only where the existing archive
   policy permits; publish only sanitized public Markdown projection, never private attribution
   fields in public derivatives.
1. Keep historical `corrected_transcript.md`/`reconciled_transcript.md` archive behavior for old
   sessions.
1. Run focused archive tests and typecheck.

### Task 8: Add immutable, isolated August 15 trial harness and reports

**Objective:** Run legacy baseline, unified single-chunk, and unified three-chunk-window candidates
without writing beneath the canonical source root or confusing trials with resumable production
roots.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationBenchmark.ts`
- Create: `cli/src/commands/transcribe/reconciliationBenchmark.test.ts`
- Create: `cli/src/commands/transcribe/reconciliationBenchmarkCommand.ts`
- Modify: `cli/src/commands/transcribe/command.ts`

**Steps:**

1. Write RED tests for source/trial realpath separation, rejection when trial is inside/equal to
   source, a required trial marker, pre/post SHA-256 receipts for canonical
   manifest/checkpoint/raw/corrected/channel map/alignment artifacts, and no canonical checkpoint
   reuse.
1. Implement three explicit lanes: `baseline`, `single`, and `window-3`. The window-3 lane may
   submit neighboring packets together, but must validate/write independent logical-chunk artifacts
   with identical schemas and ownership.
1. Emit machine-readable `report.json` and readable `report.md` containing artifact counts,
   call/retry/runtime/token metrics when available, source coverage/omissions, compression, overlap,
   attribution confidence/abstention, review flags, and immutable-input receipt comparison.
1. Baseline preserves the existing corrected transcript and runs only legacy downstream
   summary-safe/notes work in its isolated lane. Candidate notes remain trial-local and are never
   promoted automatically.
1. Run focused GREEN, typecheck, build, and benchmark-command help.

### Task 9: Run stable automated verification and independent review

**Objective:** Verify the final implementation against every approved contract before live model
cost.

**Steps:**

1. Run focused reconciliation, summary, checkpoint/pipeline, archive, and benchmark tests serially.
1. Run `pnpm -F @bastion-falls/cli test`.
1. Run `pnpm -F @bastion-falls/cli typecheck`.
1. Run `pnpm -F @bastion-falls/cli build`.
1. Run command-help probes and `git diff --check`.
1. Parent-read every new test body and trace event-accounting, fallback, cache invalidation, public
   projection, and immutable-root hooks.
1. Request independent spec-compliance review, then code-quality review, and repair material
   findings.

### Task 10: Execute and inspect the matched August 15 benchmark

**Objective:** Produce comparable baseline, single-chunk, and three-chunk trial artifacts and report
while proving the canonical fixture is unchanged.

**Steps:**

1. Capture and persist the pre-run immutable-input receipt beneath the trial root.
1. Run baseline into `.../baseline`, unified single-chunk into `.../single`, and the matched
   three-chunk experiment into `.../window-3`.
1. Resume bounded failures from each lane's own validated canonical artifacts; never copy trial
   checkpoints into the source root.
1. Generate the comparative report and inspect sampled boundary, overlap, attribution, omission,
   review-queue, summary fidelity, final-note, runtime, call, retry, and token evidence.
1. Recompute the immutable-input receipt and require byte-identical hashes before accepting the
   benchmark.
1. Report absolute trial/report paths, exact automated gates, model-call evidence, unresolved review
   items, and whether single-chunk remains the justified production default.
1. Leave all repository edits and ignored trial outputs uncommitted and unpushed.
