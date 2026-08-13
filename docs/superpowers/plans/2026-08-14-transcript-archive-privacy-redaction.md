<!-- rumdl-disable MD036 -->

# Transcript Archive Privacy Redaction Implementation Plan

> **For Hermes:** Use `software-development:subagent-driven-development` to implement this plan
> task-by-task. Follow `development:tdd-review-workflow`: focused RED/GREEN for executable privacy
> boundaries, native YAML/FFmpeg/GitHub Actions validation for declarative artifacts, and one stable
> full CLI gate before each coherent commit. Do not expose private manifests, names, timestamps, or
> source phrases in delegated prompts or public fixtures.

**Goal:** Make every new public transcript archive derive from a reviewed private session manifest,
apply audio and transcript redactions before publication, emit only a sanitized public receipt, keep
legacy audit debt visibly bounded, and permanently block deployment after all historical archives
have passed review.

**Architecture:** Add strict private-manifest and public-receipt schemas under the existing archive
module, pure transcript and audit transformers, and one bounded FFmpeg redaction adapter. Convert
`transcribe archive` into a route map whose default command preserves the existing
`archive <session>` surface and whose `audit` route uses the same public-audit engine as the archive
warning and eventual CI gate. Archive snapshots private inputs, transforms only temporary copies,
verifies every declared operation, then uses the existing atomic publication path.

**Tech Stack:** TypeScript 6, Node test runner, Zod 4, `js-yaml`, FFmpeg/FFprobe, Stricli, pnpm,
GitHub Actions, rumdl.

**Approved design:**
`docs/superpowers/specs/2026-08-14-transcript-archive-privacy-redaction-design.md`

**Target worktree:**
`/home/ensu/Projects/bastion-falls-astro/.worktrees/1-stereo-channel-remote-stt`

**Privacy rule:** `redactions.yaml` is session-local, ignored, and private. Never stage, commit,
copy into a public archive, paste into chat/review, or include its exact values in public test
fixtures. `privacy-review.yaml` is the only tracked/public audit artifact.

---

## Rollout gates

This plan has three explicit milestones:

1. **Privacy-aware archive:** Tasks 1–6. New archives fail closed and emit one migration warning.
1. **Reviewed August archives:** Task 7. Apply the real session manifests and inspect derivatives.
1. **Legacy audit:** Task 8. Review all 13 existing public archives and reach zero audit debt.
1. **Permanent CI enforcement:** Task 9. Begin only after
   `archive audit --require-complete` passes locally with zero debt.

Do not combine Tasks 8 and 9 into an optimistic CI commit. The CI gate must not be installed while
known migration debt remains.

## Changed-path boundaries

Expected implementation paths:

- `cli/src/commands/transcribe/archive/**`
- `.github/workflows/deploy.yml` only in Task 9
- `astro/src/assets/transcripts/session-*/privacy-review.yaml` only after human review in Tasks 7–8
- session-local ignored `.bf-transcripts/session-*/redactions.yaml` only in Tasks 7–8 and never
  staged
- this plan/design and narrowly necessary CLI docs

Do not modify original FLACs, raw Whisper JSON, private channel maps, or public character pages.
Preserve unrelated dirty work in the feature worktree. Stage exact task paths only.

### Task 1: Define strict private and public schemas

**Objective:** Parse a session-local private manifest and generate/validate a public-safe receipt
without accepting arbitrary filters, paths, labels, or hidden keys.

**Files:**

- Create: `cli/src/commands/transcribe/archive/privacy.ts`
- Create: `cli/src/commands/transcribe/archive/privacy.test.ts`

**Step 1: Write focused schema tests**

Add tests for:

- a reviewed-empty private manifest;
- one valid `channels: all` audio rule and one matching transcript rule;
- exact `reviewed: true` requirement;
- duplicate IDs;
- malformed, negative, reversed, zero-length, and non-finite timestamps;
- unsupported `channels`, `reason`, `speakerLabels`, replacement text, and unknown keys;
- replacement text restricted to one closed public placeholder in version one:
  `[microphone identity check redacted]`;
- public receipt acceptance with aggregate counts only;
- public receipt rejection when it contains timestamps, names, paths, rule IDs, or unknown fields.

Use synthetic values only. Do not copy August 8/9 names or intervals into tracked tests.

**Step 2: Run the focused test and witness RED**

Run:

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/privacy.test.ts
```

Expected: FAIL because `privacy.ts` or its exported symbols do not exist.

**Step 3: Implement typed parsing and serialization**

`privacy.ts` should export these stable boundaries:

```ts
export const PRIVATE_REDACTIONS_FILENAME = "redactions.yaml";
export const PUBLIC_PRIVACY_RECEIPT_FILENAME = "privacy-review.yaml";

export type PrivateRedactions = z.infer<typeof privateRedactionsSchema>;
export type PublicPrivacyReceipt = z.infer<typeof publicPrivacyReceiptSchema>;

export function parsePrivateRedactionsYaml(text: string): PrivateRedactions;
export function parsePublicPrivacyReceiptYaml(text: string): PublicPrivacyReceipt;
export function serializePublicPrivacyReceipt(receipt: PublicPrivacyReceipt): string;
export function timestampToSeconds(value: string): number;
```

Use `yaml.load` only to decode YAML, then strict Zod schemas for all semantic validation. Reject
YAML aliases/custom tags if `js-yaml` configuration permits a narrower core schema. Convert
timestamps to finite seconds in the typed parse result or through one validated helper; do not
repeatedly parse raw strings downstream.

Version one enums:

```text
reason: physical-speaker-identity
channels: all
speakerLabels: preserve | neutralize
replacement: [microphone identity check redacted]
policy: transcript-archive-privacy-v1
```

Keep `fadeMilliseconds` bounded to a small safe range, defaulting to 20 ms.

**Step 4: Run focused GREEN and typecheck**

Run:

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/privacy.test.ts
pnpm -F @bastion-falls/cli typecheck
```

Expected: all focused tests pass; typecheck exits 0.

**Step 5: Commit the schema milestone**

Stage only the two privacy files and commit:

```bash
git add cli/src/commands/transcribe/archive/privacy.ts \
  cli/src/commands/transcribe/archive/privacy.test.ts
git commit -m "feat(transcribe): define archive privacy manifests"
```

### Task 2: Transform transcript snapshots safely

**Objective:** Redact timestamped transcript events and neutralize physical-speaker labels without
global name substitution or modification of private source files.

**Files:**

- Create: `cli/src/commands/transcribe/archive/transcriptRedaction.ts`
- Create: `cli/src/commands/transcribe/archive/transcriptRedaction.test.ts`
- Modify: `cli/src/commands/transcribe/archive/privacy.ts` only if a shared typed result is needed

**Step 1: Write focused transcript RED tests**

Cover:

- parsing `[HH:MM:SS - HH:MM:SS]` lines while preserving headings and metadata;
- removing every event that overlaps a declared interval;
- inserting exactly one bounded replacement event per rule;
- preserving events immediately before and after the interval;
- reporting the application count per transcript rule;
- failing when any rule applies zero times;
- transforming `[speaker:Example Person] [channel:left]` to `[speaker:left] [channel:left]`;
- removing a physical label when no public-safe channel label exists;
- preserving already-safe `[speaker:left]` and `[speaker:right]` labels;
- rejecting any remaining `speaker:` value outside the closed public-safe set when neutralization is
  requested;
- never replacing matching words in ordinary fictional dialogue globally;
- applying the same pure transformer independently to raw, corrected, and reconciled fixtures.

**Step 2: Run focused RED**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/transcriptRedaction.test.ts
```

Expected: FAIL because the transformer does not exist.

**Step 3: Implement the pure transformer**

Export:

```ts
export interface TranscriptRedactionResult {
  text: string;
  appliedRuleIds: string[];
  redactionCount: number;
  neutralizedSpeakerLabelCount: number;
}

export function redactTranscript(
  text: string,
  manifest: PrivateRedactions,
): TranscriptRedactionResult;

export function findUnsafePublicSpeakerLabels(text: string): Array<{ line: number }>;
```

Do not return private label values in ordinary error objects. Errors should identify rule IDs from
the private invocation and the public artifact path/line number, but public receipts must never
include those IDs.

Treat only the archive plan's explicit dialogue transcript entries as transformable. Do not silently
apply the event transformer to `correction_notes.md` or `hermes_review_notes.md`; those will be
scanned and rejected if they contain unsafe structural speaker labels.

**Step 4: Run focused GREEN**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/transcriptRedaction.test.ts
pnpm -F @bastion-falls/cli typecheck
```

Expected: focused tests and typecheck pass.

**Step 5: Commit the transcript milestone**

```bash
git add cli/src/commands/transcribe/archive/transcriptRedaction.ts \
  cli/src/commands/transcribe/archive/transcriptRedaction.test.ts \
  cli/src/commands/transcribe/archive/privacy.ts
git commit -m "feat(transcribe): redact public transcript snapshots"
```

### Task 3: Build and verify lossless audio redaction

**Objective:** Silence all channels over declared intervals in one FFmpeg pass, preserve stream
shape and duration, and expose deterministic verification results to the archive orchestrator.

**Files:**

- Create: `cli/src/commands/transcribe/archive/audioRedaction.ts`
- Create: `cli/src/commands/transcribe/archive/audioRedaction.test.ts`
- Reuse: `cli/src/commands/transcribe/audio.ts`
- Reuse: `cli/src/commands/transcribe/process.ts`

**Step 1: Write argument-builder RED tests**

Test a pure `buildAudioRedactionArgs` boundary:

- no manifest-provided string is inserted as raw FFmpeg syntax;
- every interval produces a generated enable expression from validated numeric seconds;
- both channels/all channels are affected through one audio filter chain;
- 20 ms boundary fades are bounded within each interval;
- output uses FLAC and preserves input sample rate/channel count by omission of destructive `-ac` or
  `-ar` overrides;
- force behavior uses `-y` only for invocation-owned temporary output.

**Step 2: Write a real synthetic stereo integration test**

The test should:

1. skip with a clear reason only when `ffmpeg`/`ffprobe` is genuinely unavailable;
1. generate a short stereo FLAC with nonzero signal before, during, and after the test interval;
1. call the real redaction helper;
1. probe source and output through `probeAudio`;
1. assert duration within one sample-frame tolerance;
1. assert sample rate, channels, and layout match;
1. use a bounded energy measurement on both channels to prove the target window is silent;
1. prove neighboring windows remain nonzero;
1. encode the redacted FLAC with the existing `encodeToOpus` helper.

This one real integration test earns its cost because FFmpeg filter behavior and stream preservation
are privacy-critical and cannot be established by argument strings alone.

**Step 3: Run RED**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/audioRedaction.test.ts
```

Expected: FAIL because the helper does not exist.

**Step 4: Implement audio redaction and verification**

Export:

```ts
export function buildAudioRedactionArgs(options: AudioRedactionOptions): string[];
export async function redactAudioToFlac(options: AudioRedactionOptions): Promise<void>;
export async function verifyRedactedAudio(options: AudioVerificationOptions): Promise<void>;
```

Use `runCommand`, `probeAudio`, and existing progress helpers. Build filters only from validated
numbers and fixed tokens. Use one FFmpeg invocation regardless of interval count. Reject intervals
outside the probed source duration before invoking FFmpeg.

Verification must not claim semantic removal from energy alone. It proves declared windows are
silent and stream/timeline shape is preserved; final August 8/9 edge listening remains a human
acceptance step.

**Step 5: Run focused GREEN**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/audioRedaction.test.ts
pnpm -F @bastion-falls/cli typecheck
```

Expected: focused tests and typecheck pass.

**Step 6: Commit the audio milestone**

```bash
git add cli/src/commands/transcribe/archive/audioRedaction.ts \
  cli/src/commands/transcribe/archive/audioRedaction.test.ts
git commit -m "feat(transcribe): silence private archive audio spans"
```

### Task 4: Add the reusable public archive audit engine

**Objective:** Classify public archive directories and receipts through one typed engine used by the
warning, audit CLI, and eventual CI blocker.

**Files:**

- Create: `cli/src/commands/transcribe/archive/audit.ts`
- Create: `cli/src/commands/transcribe/archive/audit.test.ts`
- Modify: `cli/src/commands/transcribe/archive/privacy.ts` only for shared receipt parsing

**Step 1: Write audit classification RED tests**

Build temporary public archive directories representing:

- valid receipt and safe transcript labels;
- missing receipt;
- malformed receipt;
- leaked `redactions.yaml`;
- unsafe `[speaker:Example Person]` label;
- safe `[speaker:left]` and `[speaker:right]` labels;
- structurally inconsistent receipt/artifact counts;
- irrelevant files and non-session directories.

Assert one aggregate result with exact category counts and sorted session names. Do not write a
generic real-name detector; structural labels and receipt contracts are the automation boundary.

**Step 2: Run focused RED**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/audit.test.ts
```

Expected: FAIL because `audit.ts` does not exist.

**Step 3: Implement audit and warning formatting**

Export:

```ts
export interface PublicArchiveAuditResult { /* typed category arrays and counts */ }
export async function auditPublicArchives(outputDir: string): Promise<PublicArchiveAuditResult>;
export function formatPublicArchiveAudit(result: PublicArchiveAuditResult): string;
export function formatLegacyAuditWarning(result: PublicArchiveAuditResult): string | undefined;
export function requireCompleteAudit(result: PublicArchiveAuditResult): void;
```

The warning formatter emits exactly one block per invocation and always includes count plus:

```text
pnpm bfcli transcribe archive audit
```

`requireCompleteAudit` throws for any missing/invalid receipt, private-manifest leak, unsafe speaker
label, or structural inconsistency.

**Step 4: Run focused GREEN and existing archive tests**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/audit.test.ts \
  src/commands/transcribe/archive/impl.test.ts
pnpm -F @bastion-falls/cli typecheck
```

Expected: all selected tests pass.

**Step 5: Commit the audit engine**

```bash
git add cli/src/commands/transcribe/archive/audit.ts \
  cli/src/commands/transcribe/archive/audit.test.ts \
  cli/src/commands/transcribe/archive/privacy.ts
git commit -m "feat(transcribe): audit public transcript privacy"
```

### Task 5: Preserve the archive CLI surface while adding `audit`

**Objective:** Keep `bfcli transcribe archive <session>` and `--all` backward-compatible while
adding `bfcli transcribe archive audit [--require-complete]`.

**Files:**

- Modify: `cli/src/commands/transcribe/archive/command.ts`
- Create: `cli/src/commands/transcribe/archive/auditCommand.ts`
- Create: `cli/src/commands/transcribe/archive/auditImpl.ts`
- Create or modify a command-surface test under:
  `cli/src/commands/transcribe/archive/command.test.ts`

**Step 1: Add command-surface RED coverage**

Prove through Stricli command discovery/help that:

- `transcribe archive <session>` still routes to the existing implementation;
- existing archive flags remain on the default route;
- `transcribe archive audit` exists;
- `--require-complete` belongs only to the audit route;
- `transcribe archive --all` remains valid.

Do not settle for importing command objects; exercise the repository's actual CLI application/help
boundary if an existing helper supports it.

**Step 2: Run RED**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/command.test.ts
```

Expected: FAIL because `archive` is currently a leaf command.

**Step 3: Convert `archive` into a route map**

Rename the existing leaf object internally to `archiveRunCommand` and export:

```ts
export const archiveCommand = buildRouteMap({
  routes: {
    run: archiveRunCommand,
    audit: archiveAuditCommand,
  },
  defaultCommand: "run",
  docs: { brief: "Package and audit public transcript archives" },
});
```

Confirm Stricli's default route accepts the positional session without requiring users to spell
`run`. If the framework does not support this exact shape, preserve the public command syntax
through the smallest proven registration pattern and update the plan/spec only if the public syntax
must change.

`auditImpl.ts` resolves the configured output directory, calls `auditPublicArchives`, prints the
human summary, and sets/throws nonzero only under `--require-complete`.

**Step 4: Run command GREEN and live help probes**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/command.test.ts
pnpm bfcli transcribe archive --help
pnpm bfcli transcribe archive audit --help
pnpm -F @bastion-falls/cli typecheck
```

Expected: old archive syntax and new audit help are both discoverable.

**Step 5: Commit the CLI surface**

```bash
git add cli/src/commands/transcribe/archive/command.ts \
  cli/src/commands/transcribe/archive/auditCommand.ts \
  cli/src/commands/transcribe/archive/auditImpl.ts \
  cli/src/commands/transcribe/archive/command.test.ts
git commit -m "feat(transcribe): add archive privacy audit command"
```

### Task 6: Integrate fail-closed redaction into atomic archive publication

**Objective:** Require the private manifest, transform only snapshots, generate the sanitized
receipt, and never publish an unsanitized archive on any failure path.

**Files:**

- Modify: `cli/src/commands/transcribe/archive/impl.ts`
- Modify: `cli/src/commands/transcribe/archive/plan.ts`
- Modify: `cli/src/commands/transcribe/archive/plan.test.ts`
- Expand: `cli/src/commands/transcribe/archive/impl.test.ts`
- Reuse new privacy, transcript, audio, and audit modules

**Step 1: Refactor only enough for injectable integration tests**

Extract a narrow `ArchiveRuntime` or explicit dependency arguments for file operations that tests
cannot safely exercise directly, while keeping the real default implementation in `impl.ts`. Do not
turn the archive command into a general framework.

**Step 2: Write fail-closed integration RED tests**

Cover:

- missing `<session>/redactions.yaml` blocks before encode/publication;
- `reviewed: false` blocks;
- valid reviewed-empty manifest archives unchanged content plus a zero-count receipt;
- audio/transcript manifest routes temporary redacted files to `encodeToOpus` and archive copies;
- source transcript and normalized audio bytes remain unchanged;
- each declared transcript rule must apply;
- unsafe labels in notes/review artifacts block publication;
- `redactions.yaml` never appears in the archive entries;
- `privacy-review.yaml` always appears in a successful archive;
- audio or transcript transformation failure publishes nothing;
- one public-debt warning is emitted per command invocation;
- `--all` emits one warning total, not one per session;
- existing force backup/restore behavior remains intact.

**Step 3: Run focused RED**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/impl.test.ts \
  src/commands/transcribe/archive/plan.test.ts
```

Expected: new privacy integration assertions fail.

**Step 4: Implement archive orchestration**

In `archiveSession`:

1. resolve and parse the private manifest;
1. probe and prevalidate intervals;
1. snapshot private sources through `snapshotRegularFile`;
1. redact the temporary audio snapshot to another temporary FLAC;
1. transform only dialogue transcript snapshots;
1. scan notes/review snapshots for unsafe labels;
1. verify all declared rules and stream shape;
1. serialize a sanitized receipt into the temporary copies set;
1. encode only the redacted FLAC;
1. atomically publish through the existing path;
1. remove all invocation-owned intermediates in `finally`.

Move the public-debt scan to the top-level default command so it executes exactly once before either
single-session or `--all` processing.

`plan.ts` should classify copies by public artifact kind rather than relying on filename guessing:

```ts
type ArchiveSourceKind = "dialogue-transcript" | "review-notes" | "provenance" | "shared-rules";
```

Keep `redactions.yaml` out of `collectArchiveSources` and the static plan.

**Step 5: Run focused GREEN**

```bash
pnpm -F @bastion-falls/cli exec node --import tsx --test \
  src/commands/transcribe/archive/*.test.ts
pnpm -F @bastion-falls/cli typecheck
```

Expected: all archive tests pass.

**Step 6: Run the complete CLI milestone gates**

Freeze writers to archive source code first, then run serially:

```bash
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
pnpm bfcli transcribe archive audit
pnpm exec rumdl check \
  docs/superpowers/specs/2026-08-14-transcript-archive-privacy-redaction-design.md \
  docs/superpowers/plans/2026-08-14-transcript-archive-privacy-redaction.md
git diff --check
```

Expected:

- CLI suite/typecheck/build pass;
- audit reports 13 migration-debt archives, without pretending success;
- Markdown and diff checks pass.

**Step 7: Privacy/security review before commit**

Parent-read the exact final files and obtain one independent review focused on:

- fail-closed paths;
- private value leakage into logs/receipts/tests;
- path/symlink containment;
- FFmpeg injection resistance;
- atomic publication and cleanup;
- current CLI backward compatibility.

Resolve concrete findings through focused RED/GREEN tests. Do not start repeated speculative review
loops after the agreed invariants pass.

**Step 8: Commit the integrated archive milestone**

Stage only archive implementation/test paths and commit:

```bash
git add cli/src/commands/transcribe/archive
git commit -m "feat(transcribe): redact archives before publication"
```

### Task 7: Create and verify private August 8/9 manifests

**Objective:** Establish exact private identity-test intervals and prove the real archive
derivatives remove them without changing private evidence.

**Files:**

- Create, ignored: `astro/.bf-transcripts/session-2026-08-08/redactions.yaml`
- Create, ignored: `astro/.bf-transcripts/session-2026-08-09/redactions.yaml`
- Do not track these files
- Public archive outputs are created only after human boundary review

**Prerequisite:** August 8 and August 9 writers are complete and the ignored workspaces have been
copied/hash-verified into main according to the existing migration task. Do not archive from a
workspace still being written.

**Step 1: Hash immutable private evidence**

Record private hashes for:

- `/home/ensu/session-2026-08-08.flac`;
- `/home/ensu/session-2026-08-09.flac`;
- each session's `normalized/session.flac`;
- raw Whisper JSON inventory.

Store the verification ledger privately outside tracked public content.

**Step 2: Determine exact padded intervals**

Use raw ASR/alignment pointers only as candidates. Inspect waveform/audio at full resolution and set
sample-safe boundaries that include complete name syllables plus minimal safety padding. Silence all
channels. Include any later identity mic checks after reconnect/recharge if present.

Do not use broad name search as the redaction rule; the manifest is timestamp-scoped.

**Step 3: Write private manifests**

Create one strictly session-local `redactions.yaml` per session with exact rules and
`speakerLabels: neutralize`. Confirm both are ignored:

```bash
git check-ignore -v \
  astro/.bf-transcripts/session-2026-08-08/redactions.yaml \
  astro/.bf-transcripts/session-2026-08-09/redactions.yaml
```

Expected: both resolve to the `.bf-transcripts/` ignore rule.

**Step 4: Run privacy-aware archives into a review destination**

Use an explicit temporary output directory or the configured destination only when publication is
intended. Do not force-replace an existing public archive until the derivative has been inspected.

**Step 5: Verify real derivatives**

For each session:

- compare original/normalized hashes with Step 1;
- probe final Opus duration/channels;
- listen to every redaction boundary and verify no name fragments remain;
- inspect raw/corrected/reconciled public transcript starts;
- scan public transcripts for unsafe `speaker:` values;
- confirm `redactions.yaml` is absent from archive entries;
- inspect `privacy-review.yaml` for aggregate public-safe fields only;
- run `pnpm bfcli transcribe archive audit`.

**Step 6: Publish and commit only public outputs**

After Nico approves the inspected derivatives, stage only the public archive directory content and
sanitized receipts. Never stage the private manifests or verification ledger.

Commit message:

```text
privacy(transcripts): publish reviewed August archives
```

### Task 8: Audit and backfill the 13 legacy public archives

**Objective:** Review every existing public archive, scrub only evidence-backed identity preambles,
and reduce audit debt to zero without inventing consent findings from automated scans.

**Files:**

- Add: `astro/src/assets/transcripts/session-*/privacy-review.yaml`
- Modify existing public transcript/audio artifacts only where human audit finds a real issue
- Create private ignored manifests only if re-archiving a legacy session is required

**Step 1: Inventory with the audit command**

```bash
pnpm bfcli transcribe archive audit
```

Expected starting debt: 13 unaudited public session directories.

**Step 2: Audit one session at a time**

For each archived session:

- inspect the opening transcript window for mic tests, real names, account IDs, and physical-speaker
  labels;
- listen to the opening audio and any transcript-flagged test/reconnect window;
- inspect structural speaker-label scans;
- classify findings privately;
- add a sanitized reviewed-empty receipt when no redaction is needed;
- if redaction is needed, recover the private source/session evidence, create an ignored manifest,
  and regenerate through the privacy-aware archive command rather than hand-editing public audio.

Do not assume “no text match” equals semantic safety. Human review establishes the receipt.

**Step 3: Commit bounded review batches**

Use small reviewable batches, for example 3–5 sessions per commit. Each commit contains only public
receipts and any genuinely required scrubbed derivatives. Suggested message:

```text
privacy(transcripts): record legacy archive reviews
```

**Step 4: Prove zero debt**

```bash
pnpm bfcli transcribe archive audit --require-complete
```

Expected: exit 0, all public archives valid, zero missing/invalid receipts, zero private-manifest
leaks, and zero unsafe structural speaker labels.

Do not begin Task 9 until this exact command passes on the final audited tree.

### Task 9: Add the permanent deploy blocker

**Objective:** Prevent Cloudflare Pages publication whenever the public archive privacy contract
regresses.

**Files:**

- Modify: `.github/workflows/deploy.yml`
- Modify: `package.json` only if a stable named script is preferable to the direct CLI command
- Test existing CLI audit behavior; do not add brittle YAML substring tests

**Prerequisite:** Task 8's `archive audit --require-complete` passes locally with zero debt.

**Step 1: Add the pre-build privacy gate**

In `.github/workflows/deploy.yml`, after dependency install and before Astro build, add:

```yaml
- name: Verify transcript archive privacy
  run: pnpm bfcli transcribe archive audit --require-complete
```

Use the existing root `bfcli` wrapper. Do not add an environment-variable bypass or
`continue-on-error`.

**Step 2: Validate the workflow natively**

Run the repository's available GitHub Actions linter (`actionlint` if installed or
project-provided), plus YAML parsing if needed. The source-layout change does not earn a custom
workflow substring test; the CLI already owns the behavior.

**Step 3: Run final local gates**

```bash
pnpm bfcli transcribe archive audit --require-complete
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
pnpm -F @bastion-falls/astro build
pnpm lint
pnpm exec rumdl check \
  docs/superpowers/specs/2026-08-14-transcript-archive-privacy-redaction-design.md \
  docs/superpowers/plans/2026-08-14-transcript-archive-privacy-redaction.md
git diff --check
```

Expected: all commands pass; `--require-complete` reports zero debt before the site build.

**Step 4: Review the deployment boundary**

Confirm the final workflow order is:

```text
checkout → setup → install → archive privacy gate → site build → deploy
```

Confirm a failing audit exits before any Cloudflare deployment step.

**Step 5: Commit the permanent blocker**

```bash
git add .github/workflows/deploy.yml package.json
git commit -m "ci: block unaudited transcript publication"
```

Push and observe the exact-head workflow before claiming the publication gate is active.

## Completion evidence

The project is complete only when all of these are true:

- private session manifests are ignored and absent from Git history/archive entries;
- new archive calls fail when their private manifest is absent or ineffective;
- declared audio windows are silent on every channel in real derivatives;
- transcript windows and physical labels are safely transformed;
- originals and private evidence retain their pre-run hashes;
- every public archive has a strict sanitized receipt;
- `archive audit --require-complete` exits 0 with zero debt;
- deploy CI runs that same command before build and deploy;
- CLI tests/typecheck/build and Astro build pass;
- the deployed site is produced only after the privacy gate passes.
