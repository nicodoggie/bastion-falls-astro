# Bounded Structured Summary Repair Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Supply exact structured-summary contracts and add one bounded, fail-closed repair attempt
so canonical note generation can complete without relaxing evidence or provenance validation.

**Architecture:** Keep the existing Zod schemas and authoritative parsers in
`reconciliationSummary.ts`. Add a focused `reconciliationSummaryRepair.ts` module for contract text,
repair eligibility, sanitized issue compilation, bounded repair prompts, and private attempt
diagnostics. Route chunk, scene, and session inference through one shared runner helper that
validates initial output, invokes at most one repair, validates again from scratch, and publishes
only a fully valid canonical artifact.

**Tech Stack:** TypeScript 6, Node.js test runner, Zod 4, pnpm/Turbo, existing bounded Codex process
and atomic JSON utilities.

**Design:** `docs/superpowers/specs/2026-08-31-bounded-structured-summary-repair-design.md`

---

## Repository and Safety Boundary

Work only in:

```text
/home/ensu/Projects/bastion-falls-astro/.worktrees/unified-transcript-reconciliation
```

Expected branch:

```text
feat/unified-transcript-reconciliation
```

Allowed implementation paths:

- `cli/src/commands/transcribe/reconciliationSummary.ts`
- `cli/src/commands/transcribe/reconciliationSummary.test.ts`
- `cli/src/commands/transcribe/reconciliationSummaryRepair.ts`
- `cli/src/commands/transcribe/reconciliationSummaryRepair.test.ts`
- this plan only if implementation reveals a genuine plan correction

Private production artifacts may change only under:

- `astro/.bf-transcripts/session-2026-08-29/`
- `astro/.bf-transcripts/.runs/2026-08-29-*/`
- `astro/src/content/docs/world/notes/the-vengeful/2026-08-29.mdx`

Never modify `/home/ensu/session-2026-08-29.flac`. Do not push, merge, publish, reset, clean, or
rewrite history. Keep model output and transcript evidence out of ordinary logs and Git.

## Test Economy

Use focused RED-to-GREEN evidence for each new executable boundary. Do not rerun the full CLI suite
after every small GREEN. Run the full suite once after all implementation slices are stable, and
rerun only if final bytes change afterward. Existing atomic-publication and Codex process-lifecycle
tests remain authoritative; extend them only where the new repair path adds a distinct failure mode.

---

### Task 1: Define exact summary contracts and prompt builders

**Objective:** Replace schema-name-only instructions with deterministic complete contracts for
chunk, scene, and session inference.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationSummaryRepair.ts`
- Create: `cli/src/commands/transcribe/reconciliationSummaryRepair.test.ts`
- Modify: `cli/src/commands/transcribe/reconciliationSummary.ts:12-39,88-96,150-153`
- Modify: `cli/src/commands/transcribe/reconciliationSummary.test.ts:18-22`

#### Step 1: Add focused failing contract tests

Create tests that import:

```ts
import {
  SUMMARY_CONTRACT_VERSION,
  buildChunkContract,
  buildSceneContract,
  buildSessionContract,
} from "./reconciliationSummaryRepair.js";
```

Assert that each contract is deterministic and includes:

- its exact schema version;
- every required top-level field;
- nested required fields;
- every closed enum value;
- the unknown-key prohibition;
- authoritative ID and provenance rules;
- one synthetic valid JSON object;
- no live canonical text, absolute path, credential-shaped value, or supplied private marker.

Extend the existing prompt test to assert the chunk prompt includes `buildChunkContract()`. Add
exported `buildSceneSummaryPrompt` and `buildSessionSummaryPrompt` tests proving their corresponding
contracts are present.

#### Step 2: Run the focused tests and witness RED

Run:

```bash
cd cli
node --import tsx --test \
  --test-name-pattern='contract|prompt is deterministic|scene summary prompt|session summary prompt' \
  src/commands/transcribe/reconciliationSummaryRepair.test.ts \
  src/commands/transcribe/reconciliationSummary.test.ts
```

Expected: FAIL because the contract module and exported scene/session prompt builders do not exist.
Collection or import-runner failure is not acceptable RED; correct the command if needed.

#### Step 3: Implement the minimal contract module

In `reconciliationSummaryRepair.ts`, define:

```ts
export const SUMMARY_CONTRACT_VERSION = "summary-contract.v1";
export const SUMMARY_REPAIR_VERSION = "summary-repair.v1";
export type SummaryLevel = "chunk" | "scene" | "session";

export function buildChunkContract(): string;
export function buildSceneContract(): string;
export function buildSessionContract(): string;
export function contractFor(level: SummaryLevel): string;
```

Use deterministic literal data and `JSON.stringify(..., null, 2)`. The synthetic examples must use
obviously synthetic IDs and hashes and must fit the actual exported Zod schemas. Do not duplicate
live input data in the examples.

In `reconciliationSummary.ts`:

- append `buildChunkContract()` to `buildChunkSummaryPrompt`;
- extract and export `buildSceneSummaryPrompt`;
- extract and export `buildSessionSummaryPrompt`;
- use those builders in `runReconciliationSummarization`.

The builders must continue to include the actual authoritative chunk/group/scene data after the
static contract.

#### Step 4: Run focused GREEN tests

Run the same focused command. Expected: all selected tests pass.

#### Step 5: Run the immediate dependent summary suite

```bash
node --import tsx --test src/commands/transcribe/reconciliationSummaryRepair.test.ts \
  src/commands/transcribe/reconciliationSummary.test.ts
```

Expected: both files pass with no skipped or failed tests.

#### Step 6: Verify static boundaries

```bash
pnpm typecheck
git diff --check
```

Expected: both commands exit 0.

#### Step 7: Commit the contract milestone

```bash
git add \
  cli/src/commands/transcribe/reconciliationSummary.ts \
  cli/src/commands/transcribe/reconciliationSummary.test.ts \
  cli/src/commands/transcribe/reconciliationSummaryRepair.ts \
  cli/src/commands/transcribe/reconciliationSummaryRepair.test.ts
git commit -m "fix(transcribe): publish structured summary contracts"
```

---

### Task 2: Compile bounded repair feedback and prompts

**Objective:** Deterministically classify repair eligibility and construct privacy-safe one-shot
repair inputs without invoking a model.

**Files:**

- Modify: `cli/src/commands/transcribe/reconciliationSummaryRepair.ts`
- Modify: `cli/src/commands/transcribe/reconciliationSummaryRepair.test.ts`

#### Step 1: Add focused failing repair-core tests

Add one compact matrix covering:

1. `ZodError` becomes bounded schema issues with code, path, expected values, and no stack trace;
1. ordinary authoritative parser errors become bounded semantic issues;
1. invalid JSON text becomes a bounded parse issue;
1. timeout, abort, empty output, overflow, identity, custody, and atomic-publication failures are
   ineligible;
1. oversized original output, issue list, path, string, or final prompt fails before inference;
1. the prompt includes the target contract, original response, sanitized issues, authoritative
   domains, and exactly-one-replacement instructions;
1. the prompt excludes a supplied secret marker, absolute path, and stack marker from feedback;
1. chunk, scene, and session use the same repair policy.

Target public shapes:

```ts
export interface SummaryRepairIssue {
  stage: "parse" | "schema" | "semantic";
  code: string;
  path: readonly (string | number)[];
  message: string;
  allowedValues?: readonly string[];
}

export interface SummaryRepairContext {
  level: SummaryLevel;
  artifactId: string;
  originalOutput: unknown;
  error: unknown;
  authoritativeContext: unknown;
}

export type SummaryRepairDecision =
  | { eligible: true; issues: readonly SummaryRepairIssue[] }
  | { eligible: false; reason: string };

export function classifySummaryRepair(context: SummaryRepairContext): SummaryRepairDecision;
export function buildSummaryRepairPrompt(
  context: SummaryRepairContext,
  issues: readonly SummaryRepairIssue[],
): string;
```

#### Step 2: Run the focused tests and witness RED

```bash
node --import tsx --test \
  --test-name-pattern='repair classification|repair prompt|repair bounds' \
  src/commands/transcribe/reconciliationSummaryRepair.test.ts
```

Expected: FAIL because the classifier and prompt builder do not exist.

#### Step 3: Implement closed bounds and sanitization

Use fixed internal bounds, not new configuration:

```ts
const MAX_REPAIR_ISSUES = 128;
const MAX_REPAIR_PATH_DEPTH = 16;
const MAX_REPAIR_SEGMENT_CHARS = 128;
const MAX_REPAIR_MESSAGE_CHARS = 400;
const MAX_REPAIR_PROMPT_BYTES = 2_000_000;
```

The classifier must use closed failure categories. It must never serialize arbitrary exception
objects, stack traces, causes, or raw stderr. Normalize known Zod issues explicitly; convert safe
domain errors to a bounded generic semantic issue. Treat inference/process/custody/publication
failures as ineligible by stable error class or runner-supplied category—not fragile substring
guessing over raw provider output.

`buildSummaryRepairPrompt` must call `contractFor(level)`, encode only bounded JSON, enforce UTF-8
byte bounds, and state that the model receives no second repair.

#### Step 4: Run focused GREEN and the repair module suite

```bash
node --import tsx --test src/commands/transcribe/reconciliationSummaryRepair.test.ts
```

Expected: all repair-core tests pass.

#### Step 5: Run typecheck and diff check

```bash
pnpm typecheck
git diff --check
```

Expected: both commands exit 0.

#### Step 6: Commit the repair-core milestone

```bash
git add \
  cli/src/commands/transcribe/reconciliationSummaryRepair.ts \
  cli/src/commands/transcribe/reconciliationSummaryRepair.test.ts
git commit -m "feat(transcribe): add bounded summary repair contract"
```

---

### Task 3: Route chunk inference through one repair attempt

**Objective:** Make chunk summary generation publish on valid initial output or one valid repair,
and fail closed otherwise.

**Files:**

- Modify: `cli/src/commands/transcribe/reconciliationSummary.ts:93-153`
- Modify: `cli/src/commands/transcribe/reconciliationSummary.test.ts:21-143`
- Modify: `cli/src/commands/transcribe/reconciliationSummaryRepair.ts`
- Modify: `cli/src/commands/transcribe/reconciliationSummaryRepair.test.ts`

#### Step 1: Add a failing chunk runner regression

Add a test whose injected `infer` returns the observed malformed alias shape on its first call and a
fully valid canonical shape on its second call. Assert:

- exactly two calls;
- the second prompt is a repair prompt;
- the repair receives the same authoritative block IDs and review targets;
- the valid repaired chunk is published once;
- cache identity and caller-injected source review material are correct;
- a subsequent matching resume makes zero additional calls.

Add a companion branch where both outputs are invalid. Assert two calls, no chunk JSON publication,
and a nonzero/rejected runner result.

#### Step 2: Witness focused RED

```bash
node --import tsx --test \
  --test-name-pattern='chunk repairs one malformed response|invalid chunk repair publishes nothing' \
  src/commands/transcribe/reconciliationSummary.test.ts
```

Expected: FAIL because the existing runner validates once and throws.

#### Step 3: Add one shared attempt helper

Add a private generic helper in `reconciliationSummary.ts` with this ownership shape:

```ts
async function inferWithOneRepair<T>(options: {
  level: SummaryLevel;
  artifactId: string;
  initialPrompt: string;
  authoritativeContext: unknown;
  infer: (prompt: string, signal?: AbortSignal) => Promise<unknown>;
  validate: (value: unknown) => T;
  injectCallerOwned: (value: unknown) => unknown;
  diagnosticsRoot: string;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<T>;
```

Required behavior:

1. call initial inference once;
1. preserve the initial raw result in an owner-only private diagnostic;
1. inject caller-owned deterministic fields;
1. validate;
1. on eligible failure, build and call exactly one repair prompt;
1. preserve the repair raw result separately;
1. inject caller-owned fields and validate from scratch;
1. return only a fully valid result;
1. otherwise throw a bounded error without canonical publication.

Do not catch errors from timeout, abort, output bound, scratch cleanup, diagnostic publication, or
atomic publication as repairable model errors.

Use attempt-specific diagnostic filenames under:

```text
summarization/diagnostics/<level>-<safe-artifact-id>-initial.json
summarization/diagnostics/<level>-<safe-artifact-id>-repair.json
```

Each diagnostic file is mode `0600` through `atomicJson`. Ordinary logs and thrown messages contain
only level, artifact ID, attempt, classification, and bounded counts.

#### Step 4: Route only the chunk branch through the helper

Preserve current caller-owned injection:

```ts
{
  cacheIdentity,
  sourceSuspicionFlags: canonical.suspicionFlags,
  reviewNotes: canonical.reviewNotes,
  sourceReviewTargets: reviewTargets(canonical),
}
```

The model still owns claims, hooks, dispositions, and rolling context. `parseChunkSummary` remains
the final validator.

#### Step 5: Run focused GREEN and summary suites

```bash
node --import tsx --test \
  src/commands/transcribe/reconciliationSummaryRepair.test.ts \
  src/commands/transcribe/reconciliationSummary.test.ts
```

Expected: all tests pass.

#### Step 6: Verify typecheck and privacy assertions

```bash
pnpm typecheck
git diff --check
```

Read the changed diagnostics test and verify it asserts mode `0600`, bounded ordinary errors, and
absence of supplied secret/transcript markers outside the private raw diagnostic.

#### Step 7: Commit the chunk integration milestone

```bash
git add \
  cli/src/commands/transcribe/reconciliationSummary.ts \
  cli/src/commands/transcribe/reconciliationSummary.test.ts \
  cli/src/commands/transcribe/reconciliationSummaryRepair.ts \
  cli/src/commands/transcribe/reconciliationSummaryRepair.test.ts
git commit -m "fix(transcribe): repair malformed chunk summaries once"
```

---

### Task 4: Apply the shared repair boundary to scenes and sessions

**Objective:** Give every hierarchy level identical one-repair semantics and versioned cache
identity.

**Files:**

- Modify: `cli/src/commands/transcribe/reconciliationSummary.ts:150-153`
- Modify: `cli/src/commands/transcribe/reconciliationSummary.test.ts:88-126`

#### Step 1: Add failing scene/session integration tests

Create one representative runner test with call counters:

- chunks return valid first responses;
- the first scene response is malformed, then repaired validly;
- the first session response is malformed, then repaired validly;
- scene and session each make exactly two calls;
- all canonical files parse directly through exported schemas and authoritative parsers;
- MDX renders from the repaired session.

Add negative assertions that:

- an invalid scene repair prevents session inference;
- an invalid session repair leaves `session.json` unpublished;
- unsupported scene/session provenance after repair remains rejected;
- matching resume makes zero calls;
- changing `SUMMARY_CONTRACT_VERSION` or `SUMMARY_REPAIR_VERSION` changes all affected cache
  identities.

#### Step 2: Witness focused RED

```bash
node --import tsx --test \
  --test-name-pattern='scene and session repair once|invalid scene repair blocks session|repair version invalidates cache' \
  src/commands/transcribe/reconciliationSummary.test.ts
```

Expected: FAIL because scene/session still validate once and their identities omit repair versions.

#### Step 3: Route scene and session through the shared helper

For scenes, caller-owned injection remains:

```ts
{
  cacheIdentity,
  chunkClaimProvenance: Object.fromEntries(
    group.flatMap((chunk) =>
      chunk.claims.map((claim) => [claim.id, claim.reconciliationBlockIds]),
    ),
  ),
}
```

For sessions, caller-owned injection remains:

```ts
{
  cacheIdentity: sessionCacheIdentity,
  promptVersion: options.promptVersion,
}
```

Use `parseSceneSummary` and `parseSessionSummary` as final validators. Add contract and repair
versions to chunk, scene, and session identity objects. Do not add a new canonical schema or repair
field to reader-facing artifacts.

#### Step 4: Run focused GREEN and complete summary suites

```bash
node --import tsx --test \
  src/commands/transcribe/reconciliationSummaryRepair.test.ts \
  src/commands/transcribe/reconciliationSummary.test.ts
```

Expected: all tests pass.

#### Step 5: Run immediate integration tests

```bash
node --import tsx --test src/commands/transcribe/reconciliationIntegration.test.ts
pnpm typecheck
```

Expected: both commands pass.

#### Step 6: Commit the hierarchy integration milestone

```bash
git add \
  cli/src/commands/transcribe/reconciliationSummary.ts \
  cli/src/commands/transcribe/reconciliationSummary.test.ts
git commit -m "fix(transcribe): repair structured summaries once"
```

---

### Task 5: Verify and review the implementation candidate

**Objective:** Freeze one exact implementation commit that satisfies behavioral, type, build, lint,
format, privacy, and review gates.

**Files:**

- No planned source changes; fix only concrete failures in the allowed implementation paths.

#### Step 1: Run focused final tests serially

```bash
cd cli
node --import tsx --test \
  src/commands/transcribe/reconciliationSummaryRepair.test.ts \
  src/commands/transcribe/reconciliationSummary.test.ts \
  src/commands/transcribe/reconciliationIntegration.test.ts
```

Expected: all selected tests pass.

#### Step 2: Run full CLI verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0. Record exact test counts from the fresh run.

#### Step 3: Run repository checks

From repository root:

```bash
pnpm lint
pnpm fmt
git diff --check
git status --short
```

Expected: lint and formatter pass; formatting introduces no unrelated changes; whitespace check is
clean; status contains only intended allowed paths. If `pnpm fmt` changes implementation bytes,
rerun the focused tests, full CLI suite, typecheck, and build before review.

#### Step 4: Review exact bytes

Dispatch one read-only exact-commit review covering:

- one initial plus at most one repair call;
- complete contracts at all hierarchy levels;
- no alias coercion or partial acceptance;
- authoritative validation from scratch;
- cache invalidation and resume behavior;
- private bounded diagnostics;
- no repair for timeout, empty, overflow, identity, custody, or publication errors;
- atomic canonical publication;
- test adequacy against the observed August 29 malformed schema.

The reviewer must receive the absolute worktree, exact commit, canonical design/spec, changed-path
allowlist, immutable source prohibition, and no-edit/no-push policy. Accept `PASS` or concrete
severity/path:line findings only.

#### Step 5: Correct only reproduced findings

For each finding, reproduce it against current exact bytes, add one focused regression if it
protects a stable behavior, apply the smallest fix, and rerun affected focused and final gates. Stop
after one converged re-review; do not invite hypothetical review churn.

#### Step 6: Commit any verified review correction

Use a narrow conventional commit, for example:

```bash
git commit -m "fix(transcribe): harden bounded summary repair"
```

Nothing is pushed.

---

### Task 6: Resume August 29 and prove final-note acceptance

**Objective:** Exercise the reviewed implementation against the real private 3h47m session and
verify a complete canonical final-note artifact without rerunning STT or reconciliation.

**Files:**

- Private runtime writes: `astro/.bf-transcripts/session-2026-08-29/**`
- Private run receipt/logs: `astro/.bf-transcripts/.runs/2026-08-29-<commit>-notes/**`
- Generated note: `astro/src/content/docs/world/notes/the-vengeful/2026-08-29.mdx`

#### Step 1: Recheck immutable prerequisites

From repository root:

```bash
sha256sum /home/ensu/session-2026-08-29.flac
flac --test --silent /home/ensu/session-2026-08-29.flac
```

Expected SHA-256:

```text
b38b83db8955140f2101bd649bf0156a7dafd11c5cbcaf97dac38bd8137083a8
```

Verify:

- checkpoint and 23 canonical reconciliation files exist;
- all 23 parse through the current canonical reconciliation schema;
- source/channel/cache identities match;
- no transcription, reconciliation, summary, or stale watcher process is active;
- the worktree is clean before runtime artifacts are generated.

Stop on any identity or custody mismatch.

#### Step 2: Create a fresh owner-only run receipt

Create a new private run directory named with the exact reviewed commit. Record:

- source path, SHA-256, size, and duration;
- branch and exact code commit;
- session root;
- prior accepted summary artifacts and their identities;
- command arguments;
- purpose: structured-summary repair acceptance.

Set directory and wrapper mode `0700`; receipt and log mode `0600`. Do not rewrite historical
receipts.

#### Step 3: Start a durable bounded resume

Use the same verified local CLI path and arguments as the prior notes run:

```bash
cd astro
pnpm bfcli transcribe run /home/ensu/session-2026-08-29.flac \
  --campaign the-vengeful \
  --session-date 2026-08-29 \
  --profile m1-hybrid \
  --language en \
  --context-root src/content/docs \
  --corrections .bf-transcripts/corrections.yaml \
  --resume
```

Before execution, compare the literal campaign slug with the verified historical wrapper. Stop on
any difference; do not normalize or guess the identifier.

Run under an owner-only user systemd transient service with `KillMode=control-group`, no automatic
restart, append-only private stdout/stderr, and an attached completion watcher. The tool's internal
summary call remains bounded to 600 seconds per inference.

#### Step 4: Verify terminal artifacts programmatically

After service exit, count and parse rather than eyeballing:

- exactly 23 `summarization/chunks/session_*.json` files;
- exactly 5 `summarization/scenes/scene_*.json` files;
- one valid `summarization/session.json`;
- one nonempty `astro/src/content/docs/world/notes/the-vengeful/2026-08-29.mdx`;
- every summary cache identity matches the reviewed contract and repair versions;
- every artifact passes exported schema and authoritative provenance validation;
- checkpoint `notes_summary_pass.status` is `complete`;
- checkpoint `done.status` is `complete`;
- service result and exit status indicate success;
- no owned subprocess or orphaned Codex/transcription process remains.

A successful unit exit alone is not acceptance.

#### Step 5: Validate the generated note

Run:

```bash
pnpm -F @bastion-falls/astro lint
pnpm -F @bastion-falls/astro build
```

Expected: both commands exit 0 with the generated note present.

Read the generated MDX and verify structural fidelity:

- no private structural markers or physical-speaker metadata;
- no claim lacking provenance in the session summary;
- no hidden-canon mechanism stated as resolved when source evidence kept it uncertain;
- review-required material remains represented in hooks, confirmations, or boundaries;
- no prior-session recap is misrepresented as current-session events.

This is validation, not collaborative canon editing. Do not silently rewrite the generated note to
make acceptance pass.

#### Step 6: Report the acceptance boundary

Report:

- implementation commit and review result;
- exact test counts and static gates;
- whether initial or repair calls were used per level, without transcript content;
- artifact counts and checkpoint states;
- note path and site validation results;
- process cleanup;
- remaining human collaborative review before canonizing or publishing the note.

Leave the generated note available for Nico's review. Do not commit, push, merge, or publish it
without explicit approval.

---

## Final Completion Checklist

Implementation is complete only when all are true:

- exact chunk, scene, and session contracts are present in initial prompts;
- eligible malformed output receives at most one repair call;
- ineligible failures receive zero repair calls;
- repaired output passes all ordinary validation from scratch;
- invalid repair publishes no canonical artifact;
- diagnostics remain private and ordinary errors content-safe;
- cache identity includes contract and repair versions;
- focused, full, typecheck, build, lint, formatting, and diff gates pass on final bytes;
- exact-commit review passes;
- August 29 produces 23 chunk summaries, 5 scenes, 1 session summary, and final MDX;
- checkpoint reaches `notes_summary_pass: complete` and `done: complete`;
- site lint/build pass with the generated note;
- no owned worker remains;
- source audio and canonical reconciliation remain unchanged.
