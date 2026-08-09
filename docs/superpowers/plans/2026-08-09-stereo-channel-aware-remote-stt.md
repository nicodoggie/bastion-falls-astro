# Stereo Channel-Aware And Remote STT Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task. Run each
> behavior change through RED, GREEN, and focused review before moving on.

**Goal:** Preserve stereo recording evidence, add partial channel/speaker metadata and opt-in hybrid
transcription, and support named OpenAI-compatible remote STT targets without changing the current
local single-pass default.

**Architecture:** Keep one normalized stereo FLAC as the working source of truth, derive
unnormalized per-channel mono audio from it, and use one shared chunk plan for all passes. Resolve a
named transcription profile from Zod-validated `.bfcli.yml`, cache each pass independently, align
hybrid results into inspectable evidence, and keep the current Opus archive behavior using the
stereo master as its source.

**Tech Stack:** TypeScript 6, Node.js 22, Stricli, Zod 4, `js-yaml`, FFmpeg/FFprobe, Node `fetch`,
and Node's built-in test runner.

**Design:** `docs/superpowers/specs/2026-08-09-stereo-channel-aware-remote-stt-design.md`

**Execution guard:** Suggested commits appear below for issue-linked implementation. Do not create a
GitHub issue, branch, worktree, commit, push, or PR until Nico explicitly approves those external or
repository-history actions.

---

## Task 1: Add Zod-Validated Transcription Profiles And Targets

**Objective:** Resolve one named profile into a stereo or hybrid layout and one typed local or
remote STT target while preserving all existing transcribe configuration fields.

**Files:**

- Create: `cli/src/commands/transcribe/settings.ts`
- Create: `cli/src/commands/transcribe/settings.test.ts`
- Modify: `cli/src/commands/transcribe/command.ts`

### Step 1: Write the focused schema tests

Create `settings.test.ts` with these three owned cases:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTranscriptionProfile } from "./settings.js";

test("preserves the local single-pass default when profiles are absent", () => {
  assert.deepEqual(resolveTranscriptionProfile({}, undefined), {
    name: "legacy-local",
    layout: "stereo",
    target: {
      name: "legacy-local",
      provider: "nodejs-whisper",
      model: "large-v3-turbo",
    },
  });
});

test("resolves a named hybrid OpenAI-compatible profile", () => {
  const resolved = resolveTranscriptionProfile(
    {
      defaultProfile: "m1-hybrid",
      profiles: {
        "m1-hybrid": { layout: "hybrid", target: "m1-whisper" },
      },
      targets: {
        "m1-whisper": {
          provider: "openai-compatible",
          baseUrl: "http://ensu-macos:8000/v1",
          model: "large-v3-turbo",
          timeoutSeconds: 900,
          retries: 2,
        },
      },
    },
    undefined,
  );

  assert.equal(resolved.layout, "hybrid");
  assert.equal(resolved.target.provider, "openai-compatible");
});

test("rejects a profile that references an unknown target", () => {
  assert.throws(
    () =>
      resolveTranscriptionProfile(
        {
          defaultProfile: "broken",
          profiles: { broken: { layout: "hybrid", target: "missing" } },
          targets: {},
        },
        undefined,
      ),
    /unknown target.*missing/i,
  );
});
```

Do not enumerate every Zod primitive failure. The tests protect the compatibility default, a
complete remote profile, and the cross-reference refinement Zod cannot provide automatically.

### Step 2: Run the test and verify RED

Run from `cli/`:

```bash
node --import tsx --test src/commands/transcribe/settings.test.ts
```

Expected: FAIL because `settings.ts` does not exist.

### Step 3: Implement the discriminated schemas and resolver

In `settings.ts`, define:

```ts
const localTargetSchema = z.object({
  provider: z.enum(["nodejs-whisper", "faster-whisper"]),
  model: z.string().trim().min(1),
});

const openAiTargetSchema = z.object({
  provider: z.literal("openai-compatible"),
  baseUrl: z.url(),
  model: z.string().trim().min(1),
  apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  timeoutSeconds: z.number().int().positive().default(900),
  retries: z.number().int().min(0).max(10).default(2),
});

export const transcriptionSettingsSchema = z.object({
  defaultProfile: z.string().trim().min(1).optional(),
  profiles: z.record(
    z.string(),
    z.object({
      layout: z.enum(["stereo", "hybrid"]),
      target: z.string().trim().min(1),
    }),
  ).default({}),
  targets: z.record(
    z.string(),
    z.discriminatedUnion("provider", [localTargetSchema, openAiTargetSchema]),
  ).default({}),
});
```

Export `z.infer` types and `resolveTranscriptionProfile(raw, overrideName)`. Resolve in this order:

1. explicit profile override;
1. configured `defaultProfile`;
1. the existing local `nodejs-whisper` model/backend options.

Parse only the profile/target subsection. Do not make the entire existing `transcribe` object
strict, because it also owns archive and review settings.

### Step 4: Integrate profile resolution without changing execution yet

Add optional `profile` to `TranscribeFlags` and the run command's Stricli flags. In `command.ts`,
parse `getTranscribeConfig()` once and resolve the effective profile, but continue invoking the
current local backend until Task 6 wires target dispatch.

Print only the profile name, layout, provider, and model. Never resolve or print an API-key value
here.

### Step 5: Run focused tests and typecheck

```bash
node --import tsx --test src/commands/transcribe/settings.test.ts
pnpm typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

### Step 6: Suggested commit

```bash
git add cli/src/commands/transcribe/settings.ts \
  cli/src/commands/transcribe/settings.test.ts \
  cli/src/commands/transcribe/command.ts
git commit -m "feat(transcribe): add named STT profiles"
```

## Task 2: Define And Scaffold The Versioned Channel Map

**Objective:** Make one Zod schema authoritative for partial channel, physical-speaker, and
expected-character mappings, then scaffold that YAML from probed audio.

**Files:**

- Create: `cli/src/commands/transcribe/channelMap.ts`
- Create: `cli/src/commands/transcribe/channelMap.test.ts`
- Create: `cli/src/commands/transcribe/sessionPaths.ts`
- Create: `cli/src/commands/transcribe/channels/command.ts`
- Create: `cli/src/commands/transcribe/channels/impl.ts`
- Modify: `cli/src/commands/transcribe/command.ts`

### Step 1: Write the three efficient schema/scaffold tests

The tests must cover only:

1. a minimal partial mapping parses;
1. duplicate channel IDs or indexes fail through a `superRefine` issue;
1. scaffold output for a two-channel probe serializes and parses back through the same schema.

Use `yaml.load` only at the boundary. Compare parsed domain objects, not full YAML snapshots.

The partial fixture should prove that a known physical speaker may have no known character and that
an empty speaker list is valid.

### Step 2: Run the test and verify RED

```bash
node --import tsx --test src/commands/transcribe/channelMap.test.ts
```

Expected: FAIL because `channelMap.ts` does not exist.

### Step 3: Implement the Zod schemas and YAML boundary

Implement and export:

```ts
export const expectedCharacterSchema = z.object({
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
});

export const physicalSpeakerSchema = z.object({
  name: z.string().trim().min(1),
  role: z.enum(["gm", "player", "guest", "unknown"]),
  expectedCharacters: z.array(expectedCharacterSchema).default([]),
});

export const channelMapSchema = z
  .object({
    version: z.literal(1),
    source: z.string().trim().min(1),
    channels: z.array(
      z.object({
        id: z.string().trim().min(1),
        index: z.number().int().nonnegative(),
        speakers: z.array(physicalSpeakerSchema).default([]),
        notes: z.string().trim().optional(),
      }),
    ).min(1),
  })
  .superRefine(addUniqueChannelAndAliasIssues);
```

Add `parseChannelMap`, `loadChannelMap`, `buildChannelMapScaffold`, and `writeChannelMap`. The
writer validates the generated object before calling `yaml.dump` and refuses overwrite unless
forced.

### Step 4: Extract shared session path resolution

Move the pure audio-stem slugging and default output-directory calculation from `command.ts` to
`sessionPaths.ts`. Both `run` and `channels init` must use this function so they cannot disagree
about where `channel-map.yml` belongs.

### Step 5: Register the scaffold command

Create a nested `transcribe channels` route map with `init`. It accepts the audio positional
argument and the existing campaign/session-date/out/force concepts. The implementation:

1. resolves the source and session directory;
1. calls the audio probe introduced in Task 3;
1. maps ordinary stereo channels to stable IDs `left` and `right`, otherwise `channel-<index>`;
1. writes `channel-map.yml`;
1. prints its path and the number of detected channels.

Task 2 may define the command and inject a probe function in its unit test. Complete the real probe
binding in Task 3 rather than mocking FFprobe behavior twice.

### Step 6: Run focused tests and typecheck

```bash
node --import tsx --test src/commands/transcribe/channelMap.test.ts
pnpm typecheck
```

Expected: PASS.

### Step 7: Suggested commit

```bash
git add cli/src/commands/transcribe/channelMap.ts \
  cli/src/commands/transcribe/channelMap.test.ts \
  cli/src/commands/transcribe/sessionPaths.ts \
  cli/src/commands/transcribe/channels/ \
  cli/src/commands/transcribe/command.ts
git commit -m "feat(transcribe): scaffold channel speaker maps"
```

## Task 3: Preserve Stereo And Derive Aligned Mono Channels

**Objective:** Replace unconditional mono normalization with a stereo-safe master and reproducible
per-channel derivatives while proving the resulting artifacts, not FFmpeg argument trivia.

**Files:**

- Modify: `cli/src/commands/transcribe/audio.ts`
- Modify: `cli/src/commands/transcribe/audio.test.ts`
- Modify: `cli/src/commands/transcribe/types.ts`
- Modify: `cli/src/commands/transcribe/command.ts`
- Modify: `cli/src/commands/transcribe/channels/impl.ts`

### Step 1: Replace the low-value normalize-argument test with one artifact test

Generate a one-second stereo FLAC in a temporary directory using two sine inputs with intentionally
different amplitudes. Run the real preparation functions, then assert through FFprobe and a small
energy probe that:

- `normalized/session.flac` has two channels;
- `normalized/channels/left.flac` and `right.flac` each have one channel;
- all three durations agree within a small container/codec tolerance;
- the originally louder side remains louder after normalization and splitting.

Assert only relative ordering, not exact dB values. Skip with a clear reason only when
FFmpeg/FFprobe is genuinely absent; the production command already requires both tools.

### Step 2: Run the artifact test and verify RED

```bash
node --import tsx --test src/commands/transcribe/audio.test.ts
```

Expected: FAIL because normalization still forces `-ac 1` and channel derivation does not exist.

### Step 3: Add the audio probe contract

Add:

```ts
export interface AudioStreamInfo {
  durationSeconds: number;
  channels: number;
  channelLayout?: string;
  sampleRate: number;
}

export async function probeAudio(path: string): Promise<AudioStreamInfo>;
```

Use one FFprobe JSON request. Make `getAudioDurationSeconds` delegate to `probeAudio` or a shared
parser so duration probing is not duplicated.

### Step 4: Make normalization stereo-safe

Replace the hard-coded `-ac 1` with an optional output-channel argument. The run pipeline must
preserve the source channel count for the normalized master. Keep the existing speech sample rate
and filters; do not independently normalize channels.

Add:

```ts
export async function deriveMonoChannels(options: {
  stereoPath: string;
  channelsDir: string;
  channelCount: number;
  force: boolean;
  progress?: ProgressSink;
}): Promise<PreparedChannel[]>;
```

Use FFmpeg `pan`/channel mapping against the normalized stereo file. Stable artifact names come from
the probed channel IDs.

### Step 5: Extend audio manifest types

Evolve `Manifest` to version 2 with:

- `version: 2`;
- source fingerprint and probe metadata;
- normalized stereo path;
- prepared channel ID/index/path metadata;
- shared chunk settings and planned boundaries.

Reject an unversioned/version-one manifest for stereo-aware resume with an actionable rebuild
message. Do not write a speculative migration for artifacts whose old normalized audio may already
be mono.

### Step 6: Bind the real probe to scaffold and preparation

Wire `channels init` to `probeAudio`. In `run`, probe before normalization, preserve the master
channel count, then derive channels from the normalized master when the source has more than one
channel.

Do not yet generate channel chunks; Task 4 owns pass-specific chunk paths.

### Step 7: Run focused tests and typecheck

```bash
node --import tsx --test src/commands/transcribe/audio.test.ts \
  src/commands/transcribe/channelMap.test.ts
pnpm typecheck
```

Expected: PASS.

### Step 8: Suggested commit

```bash
git add cli/src/commands/transcribe/audio.ts \
  cli/src/commands/transcribe/audio.test.ts \
  cli/src/commands/transcribe/types.ts \
  cli/src/commands/transcribe/command.ts \
  cli/src/commands/transcribe/channels/impl.ts
git commit -m "feat(transcribe): preserve stereo audio channels"
```

## Task 4: Add Shared Pass Paths, Chunk Selection, And Truthful Resume State

**Objective:** Use one logical chunk plan for stereo and channel passes, select bounded chunks, and
track completion per pass without claiming a partial experiment is complete.

**Files:**

- Create: `cli/src/commands/transcribe/passes.ts`
- Create: `cli/src/commands/transcribe/passes.test.ts`
- Modify: `cli/src/commands/transcribe/resume.ts`
- Modify: `cli/src/commands/transcribe/resume.test.ts`
- Modify: `cli/src/commands/transcribe/checkpoint.ts`
- Modify: `cli/src/commands/transcribe/checkpoint.test.ts`
- Modify: `cli/src/commands/transcribe/audio.ts`
- Modify: `cli/src/commands/transcribe/command.ts`

### Step 1: Write one table-driven pass/selection test

Protect these cases in one test table:

- `0` selects chunk 0;
- `0-2` selects 0, 1, 2;
- `0,4,7` selects those indexes in sorted unique order;
- out-of-range, negative, reversed, or malformed selectors fail;
- stereo layout requires only pass `stereo`;
- hybrid requires `stereo` plus every prepared channel pass.

### Step 2: Run the test and verify RED

```bash
node --import tsx --test src/commands/transcribe/passes.test.ts
```

Expected: FAIL because `passes.ts` does not exist.

### Step 3: Implement pass and chunk-selection domain functions

Export pure functions:

```ts
export type TranscriptionPass =
  | { kind: "stereo"; id: "stereo" }
  | { kind: "channel"; id: string; channelIndex: number };

export function requiredPasses(
  layout: "stereo" | "hybrid",
  channels: PreparedChannel[],
): TranscriptionPass[];

export function parseChunkSelection(
  value: string | undefined,
  availableIndexes: number[],
): number[];
```

Add pure path builders for pass-specific chunk audio, raw JSON, raw Markdown, and alignment
artifacts. Do not scatter directory conventions through `command.ts`.

### Step 4: Generate all pass audio from the shared boundaries

Generalize `chunkAudio` so it accepts one input/path set and the already planned boundaries. In
stereo layout, generate only conversational chunks. In hybrid preparation, or in preparation
independent of layout if storage cost is acceptable, generate channel chunks from each derivative
using the same boundaries.

The implementation should prefer lazy/reproducible generation: always prepare the stereo chunks;
generate channel chunks when hybrid is first requested. Record their availability separately.

### Step 5: Evolve checkpoint state to pass-level completion

Replace the single `transcribed_chunks.completed` list with a record keyed by pass ID. Preserve
atomic checkpoint writes.

The checkpoint must distinguish:

- audio preparation complete;
- required pass IDs for the active profile;
- completed chunk indexes per pass;
- bounded selection used for the current invocation;
- all-required-pass completion.

A bounded selection updates only those pass/index entries. `done` remains pending until the complete
session and all downstream stages are complete.

### Step 6: Update resume validation

Teach `canReuseAudioChunks` to validate pass-specific artifacts against manifest version 2. Keep its
return value explicit about missing paths per pass rather than one flat missing-index array.

### Step 7: Run the focused resume/checkpoint suite

```bash
node --import tsx --test \
  src/commands/transcribe/passes.test.ts \
  src/commands/transcribe/resume.test.ts \
  src/commands/transcribe/checkpoint.test.ts
pnpm typecheck
```

Expected: PASS.

### Step 8: Suggested commit

```bash
git add cli/src/commands/transcribe/passes.ts \
  cli/src/commands/transcribe/passes.test.ts \
  cli/src/commands/transcribe/resume.ts \
  cli/src/commands/transcribe/resume.test.ts \
  cli/src/commands/transcribe/checkpoint.ts \
  cli/src/commands/transcribe/checkpoint.test.ts \
  cli/src/commands/transcribe/audio.ts \
  cli/src/commands/transcribe/command.ts
git commit -m "feat(transcribe): track resumable transcription passes"
```

## Task 5: Add The OpenAI-Compatible STT Adapter

**Objective:** Transcribe one pass remotely through `/audio/transcriptions`, normalize verbose timed
segments, retry only transient failures, and never silently fall back.

**Files:**

- Create: `cli/src/commands/transcribe/openAiStt.ts`
- Create: `cli/src/commands/transcribe/openAiStt.test.ts`
- Modify: `cli/src/commands/transcribe/sttBackend.ts`
- Modify: `cli/src/commands/transcribe/types.ts`

### Step 1: Write one mock-server contract test

Start a local Node HTTP server on an ephemeral port. For one request, assert that the adapter sends:

- `POST /v1/audio/transcriptions`;
- multipart audio;
- configured model;
- `response_format=verbose_json`;
- language/prompt only when supplied;
- bearer authorization only when `apiKeyEnv` resolves.

Return two timed segments and assert the normalized `ChunkTranscript` domain. Do not inspect
multipart boundary bytes beyond fields needed by the public contract.

### Step 2: Write one bounded-failure test

Have the same server return a transient failure through the configured retry count. Assert that the
error names the target and chunk and that no fallback callback/provider is invoked.

A permanent 4xx may be included in the same table only if it does not create another server fixture.

### Step 3: Run tests and verify RED

```bash
node --import tsx --test src/commands/transcribe/openAiStt.test.ts
```

Expected: FAIL because the adapter does not exist.

### Step 4: Implement the adapter

Use Node's native `fetch`, `FormData`, `Blob`, and `AbortSignal.timeout`; add no HTTP dependency.
Resolve `apiKeyEnv` immediately before the request. If configured but absent, fail without making a
request.

Normalize compatible verbose responses with a Zod response schema. Require timestamped segments;
reject text-only responses because they cannot participate safely in overlap assembly or hybrid
alignment.

Retry only connection errors, timeouts, HTTP 408, HTTP 429, and HTTP 5xx. Use a small bounded
backoff inside the adapter. Do not log response bodies that may contain transcript data unless the
existing verbose/debug path explicitly owns that behavior.

### Step 5: Extend the backend dispatcher

Evolve `SttBackend` into a narrow adapter contract or dispatch function that accepts:

```ts
interface TranscribePassRequest {
  target: ResolvedSttTarget;
  pass: TranscriptionPass;
  chunks: Array<{ index: number; path: string }>;
  outDir: string;
  language: string;
  prompt?: string;
  force: boolean;
}
```

Adapt the existing `nodejs-whisper` and `faster-whisper` implementations without rewriting their
model logic. Dispatch `openai-compatible` to the new adapter.

### Step 6: Run focused tests and typecheck

```bash
node --import tsx --test \
  src/commands/transcribe/openAiStt.test.ts \
  src/commands/transcribe/sttBackend.test.ts
pnpm typecheck
```

If `sttBackend.test.ts` does not yet exist, add only one dispatch test; do not duplicate each
provider's own tests.

Expected: PASS.

### Step 7: Suggested commit

```bash
git add cli/src/commands/transcribe/openAiStt.ts \
  cli/src/commands/transcribe/openAiStt.test.ts \
  cli/src/commands/transcribe/sttBackend.ts \
  cli/src/commands/transcribe/sttBackend.test.ts \
  cli/src/commands/transcribe/types.ts
git commit -m "feat(transcribe): add OpenAI-compatible STT target"
```

## Task 6: Execute And Cache Stereo Or Hybrid Passes

**Objective:** Run only missing selected pass/chunk pairs for the resolved profile and preserve each
pass as inspectable JSON and Markdown.

**Files:**

- Create: `cli/src/commands/transcribe/pipeline.ts`
- Create: `cli/src/commands/transcribe/pipeline.test.ts`
- Modify: `cli/src/commands/transcribe/command.ts`
- Modify: `cli/src/commands/transcribe/assembly.ts`

### Step 1: Write one lifecycle test with injected runners

Use temporary files plus fake audio/STT runners. Exercise this sequence:

1. prepare a two-channel source and stop after audio chunking;
1. run stereo profile for chunk 0;
1. switch to hybrid profile for chunk 0;
1. verify the cached stereo result is reused and only left/right run;
1. verify chunk 1 and workflow `done` remain pending;
1. resume without selection and verify only missing pass/chunk pairs run.

This is the single owned lifecycle test. Do not create separate integration suites for `prepare`,
`--stop-after`, `--chunks`, and `--resume`.

### Step 2: Run the lifecycle test and verify RED

```bash
node --import tsx --test src/commands/transcribe/pipeline.test.ts
```

Expected: FAIL because the reusable pipeline orchestrator does not exist.

### Step 3: Extract the staged orchestrator

Move the stage sequencing from the large `command.ts` handler into `pipeline.ts`. Keep CLI parsing
and human-readable output in `command.ts`; inject process/audio/STT/correction dependencies into the
pipeline for the lifecycle test.

Use an ordered stage enum:

```ts
export const transcribeStages = [
  "normalization",
  "audio-chunking",
  "transcription",
  "raw-assembly",
  "correction-review",
  "notes",
] as const;
```

The pipeline returns after the selected cutoff and writes a truthful checkpoint first.

### Step 4: Run required pass/chunk pairs

Resolve passes from profile and prepared channels, intersect them with selected chunk indexes, skip
valid cached output unless forced, dispatch the rest through `sttBackend`, and update the checkpoint
after every completed chunk.

Write pass-specific raw JSON and formatted Markdown. The existing local-single artifact names may
remain compatibility aliases for the stereo pass, but one canonical path must own each artifact.

### Step 5: Register `prepare`, `--stop-after`, and `--chunks`

Add:

- `transcribe prepare` using the same flags/positionals as run but forcing the `audio-chunking`
  cutoff;
- optional `--stop-after` on `run`;
- optional `--chunks` on `run`;
- optional `--profile` from Task 1.

Keep the existing `transcribe audio` alias for backward compatibility unless repository history
proves it safe to deprecate separately.

### Step 6: Run focused tests and typecheck

```bash
node --import tsx --test \
  src/commands/transcribe/pipeline.test.ts \
  src/commands/transcribe/checkpoint.test.ts \
  src/commands/transcribe/resume.test.ts
pnpm typecheck
```

Expected: PASS.

### Step 7: Suggested commit

```bash
git add cli/src/commands/transcribe/pipeline.ts \
  cli/src/commands/transcribe/pipeline.test.ts \
  cli/src/commands/transcribe/command.ts \
  cli/src/commands/transcribe/assembly.ts
git commit -m "feat(transcribe): add staged hybrid transcription runs"
```

## Task 7: Align Hybrid Evidence And Apply Physical-Speaker Context

**Objective:** Preserve stereo conversational wording, collapse clear bleed conservatively, attach
channel alternatives, and assign only evidence-supported physical speakers.

**Files:**

- Create: `cli/src/commands/transcribe/alignment.ts`
- Create: `cli/src/commands/transcribe/alignment.test.ts`
- Modify: `cli/src/commands/transcribe/assembly.ts`
- Modify: `cli/src/commands/transcribe/codex.ts`
- Modify: `cli/src/commands/transcribe/codex.test.ts`
- Modify: `cli/src/commands/transcribe/pipeline.ts`

### Step 1: Write one table-driven alignment test

One input fixture should contain:

- a normal stereo segment aligned with one dominant channel;
- the same text bleeding into the other channel;
- a channel wording alternative with better proper-name spelling;
- materially different overlapping speech;
- one mapped physical speaker with several possible characters.

Assert:

- stereo text remains the deterministic primary wording;
- duplicate bleed becomes one event with alternatives/evidence;
- overlapping different speech remains separate;
- unambiguous channel dominance assigns the physical person;
- no expected character is assigned automatically;
- the alignment JSON preserves all alternatives needed for correction/review.

Pass precomputed relative-energy values into the pure merger. Audio energy extraction belongs to the
audio boundary and should not make this unit test invoke FFmpeg.

### Step 2: Run the test and verify RED

```bash
node --import tsx --test src/commands/transcribe/alignment.test.ts
```

Expected: FAIL because the alignment domain does not exist.

### Step 3: Implement conservative alignment

Implement global-time conversion, temporal overlap, normalized text similarity, duplicate grouping,
and speaker attribution. Keep thresholds as named internal constants with comments describing the
risk they bound; do not expose a new configuration surface before real-recording measurements.

A merged event must retain:

- chosen primary text and source pass;
- global start/end;
- every aligned alternative and source pass;
- confidence fields when supplied by STT;
- relative channel energy when available;
- physical speaker and channel only when unambiguous;
- no inferred character field unless later evidence explicitly supplies one.

### Step 4: Write inspectable alignment artifacts

For hybrid chunks, write:

- `alignment/session_000.json` with full evidence;
- pass-aware raw Markdown;
- assembled `raw_transcript.md` with channel and physical-speaker labels.

For stereo-only runs, preserve current raw transcript readability and behavior.

### Step 5: Pass channel context into correction prompts

Extend `buildCodexCorrectionPrompt` with optional channel evidence and parsed channel-map context.
Add one focused assertion to the existing correction-prompt test proving that the prompt:

- treats physical-speaker labels as authoritative evidence;
- presents expected characters as possibilities;
- forbids assigning a character from roster membership alone;
- asks the model to use cleaner aligned alternatives for spelling.

Do not duplicate these assertions across every notes prompt. Notes consume the corrected/assembled
transcript and should omit technical channel labels in prose through one existing final-notes prompt
instruction.

### Step 6: Run focused tests and typecheck

```bash
node --import tsx --test \
  src/commands/transcribe/alignment.test.ts \
  src/commands/transcribe/assembly.test.ts \
  src/commands/transcribe/codex.test.ts
pnpm typecheck
```

Expected: PASS.

### Step 7: Suggested commit

```bash
git add cli/src/commands/transcribe/alignment.ts \
  cli/src/commands/transcribe/alignment.test.ts \
  cli/src/commands/transcribe/assembly.ts \
  cli/src/commands/transcribe/codex.ts \
  cli/src/commands/transcribe/codex.test.ts \
  cli/src/commands/transcribe/pipeline.ts
git commit -m "feat(transcribe): align channel speaker evidence"
```

## Task 8: Preserve Stereo Opus And Provenance In Archives

**Objective:** Continue producing compact stereo Opus for posterity while adding small provenance
artifacts and excluding reproducible FLAC derivatives/chunks.

**Files:**

- Modify: `cli/src/commands/transcribe/archive/plan.ts`
- Modify: `cli/src/commands/transcribe/archive/plan.test.ts`
- Modify: `cli/src/commands/transcribe/archive/impl.ts`
- Modify: `cli/src/commands/transcribe/archive/encode.test.ts`

### Step 1: Extend the existing archive-plan test

Update the single copies assertion to include, when present:

- `manifest.json`;
- `checkpoint.json`;
- `channel-map.yml`;
- alignment and pass transcript evidence through an explicitly collected text/JSON directory set.

Assert that no source entry starts with:

- `normalized/channels/`;
- `chunks/`.

Do not add a second archive end-to-end fixture.

### Step 2: Strengthen the existing Opus argument assertion

The existing complete `buildOpusArgs` equality already proves `libopus`, configured bitrate, and the
absence of `-ac 1`. Rename its test to state the stereo-preservation contract. Do not add a
duplicate test containing the same argument list.

### Step 3: Run archive tests and verify RED where provenance is missing

```bash
node --import tsx --test src/commands/transcribe/archive/*.test.ts
```

Expected: the plan test FAILS for missing provenance entries; the existing Opus encode behavior
stays GREEN.

### Step 4: Implement bounded provenance collection

Keep `normalized/session.flac` as `audioSource`. Keep `AUDIO_EXTENSION = "opus"` and `libopus` at
the existing configurable bitrate. Add only authored/generated transcript JSON/Markdown/YAML
provenance trees to the archive plan.

When collecting directories, allowlist extensions and resolve every entry beneath the session root
to prevent traversal or accidental source-audio inclusion. Do not recursively archive arbitrary
session contents.

### Step 5: Run archive tests and typecheck

```bash
node --import tsx --test src/commands/transcribe/archive/*.test.ts
pnpm typecheck
```

Expected: PASS.

### Step 6: Suggested commit

```bash
git add cli/src/commands/transcribe/archive/
git commit -m "feat(transcribe): archive stereo channel provenance"
```

## Task 9: Configure Bastion Falls Profiles And Verify The CLI Surface

**Objective:** Add explicit local-single and opt-in M1 hybrid profiles without embedding credentials
or changing the default transcription path.

**Files:**

- Modify: `astro/.bfcli.yml`
- Modify: `docs/superpowers/specs/2026-08-09-stereo-channel-aware-remote-stt-design.md` only if
  implementation evidence requires a correction

### Step 1: Add project profiles

Preserve the existing `transcribeDir`, `outputDir`, compression, bitrate, and review settings. Add:

```yaml
transcribe:
  defaultProfile: local-single
  profiles:
    local-single:
      layout: stereo
      target: local-whisper
    m1-hybrid-test:
      layout: hybrid
      target: m1-whisper-turbo
  targets:
    local-whisper:
      provider: nodejs-whisper
      model: large-v3-turbo
    m1-whisper-turbo:
      provider: openai-compatible
      baseUrl: http://ensu-macos:8000/v1
      model: large-v3-turbo
      timeoutSeconds: 900
      retries: 2
```

Do not add `apiKeyEnv` unless the actual server requires authentication. Never place a credential
value in this file.

### Step 2: Check real command help

From `cli/`:

```bash
pnpm exec tsx --tsconfig src/tsconfig.json src/bin/cli.ts transcribe --help
pnpm exec tsx --tsconfig src/tsconfig.json src/bin/cli.ts transcribe run --help
pnpm exec tsx --tsconfig src/tsconfig.json src/bin/cli.ts transcribe prepare --help
pnpm exec tsx --tsconfig src/tsconfig.json src/bin/cli.ts transcribe channels init --help
```

Expected: commands load successfully; help shows one profile override plus stage/chunk operational
controls, not provider-specific remote flag soup.

### Step 3: Run configuration-focused verification

```bash
node --import tsx --test \
  src/commands/transcribe/settings.test.ts \
  src/commands/transcribe/channelMap.test.ts
pnpm typecheck
```

Expected: PASS.

### Step 4: Suggested commit

```bash
git add astro/.bfcli.yml
git commit -m "config(transcribe): add local and M1 STT profiles"
```

## Task 10: Run Final Automated And Manual Acceptance

**Objective:** Prove the effective CLI change once, then compare one real chunk before spending
full-session compute.

**Files:**

- Review all files changed by Tasks 1–9
- Do not add permanent real-recording fixtures

### Step 1: Run focused transcribe tests

From `cli/`:

```bash
node --import tsx --test \
  src/commands/transcribe/*.test.ts \
  src/commands/transcribe/archive/*.test.ts
```

Expected: all transcribe tests PASS.

### Step 2: Run package gates once

From the repository root:

```bash
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli build
```

Expected: all commands exit 0. Do not run unrelated Astro/root tests unless the diff unexpectedly
crosses package boundaries.

### Step 3: Review the effective diff and repository state

```bash
git diff --check
git diff --stat
git status --short --branch
```

Inspect every changed file for:

- source stereo preservation;
- no literal credentials;
- no silent target fallback;
- no physical-speaker/character conflation;
- no false checkpoint completion;
- no unapproved generated or recording artifacts;
- no unrelated formatting changes.

### Step 4: Prepare one real session without STT

After building the CLI, run from `astro/` so its `.bfcli.yml` is the active project configuration.
Use the actual source path supplied at execution time:

```bash
node ../cli/dist/cli.js transcribe channels init <source-audio> \
  --campaign <campaign> \
  --session-date <date>
node ../cli/dist/cli.js transcribe prepare <source-audio> \
  --campaign <campaign> \
  --session-date <date>
```

Expected: untouched source, stereo normalized FLAC, mono derivatives, shared chunks, channel-map
YAML, manifest, and checkpoint. Inspect channel counts with FFprobe before any STT request.

### Step 5: Benchmark one chunk

Run chunk 0 first with `--profile local-single`, then with `--profile m1-hybrid-test`. Those two
high-level profile names and the bounded chunk selector replace provider/model flag soup. Keep the
configured default unchanged.

Compare:

- elapsed time;
- stereo-pass cache reuse;
- obscure proper-name pickup;
- conversational context across channels;
- physical-speaker attribution;
- bleed handling;
- M1 resource pressure.

Expected: a reviewable comparison, not a predetermined hybrid victory. Do not process the complete
recording until Nico approves the measured tradeoff.

### Step 6: Verify archive behavior on the prepared/reviewed session

Create an archive only after transcript artifacts exist. Inspect its file list and probe
`session-audio.opus` after extraction.

Expected:

- Opus codec at configured bitrate;
- two audio channels;
- transcript/channel-map/alignment provenance;
- no normalized FLAC master, channel derivatives, or chunk audio.

### Step 7: Suggested final commit and PR handoff

Only after explicit authorization:

```bash
git add <only-files-owned-by-this-plan>
git commit -m "feat(transcribe): preserve stereo speaker context"
```

If issue/PR workflow was approved, push the issue-linked branch, open the PR, and report the exact
test commands and one-chunk benchmark separately from automated CI evidence.

## Stop Rule

Stop when the design acceptance criteria and Task 10 verification pass. Do not add voice embeddings,
automatic character recognition, adaptive hybrid selection, SSH transport, a custom STT server,
OpenAI-incompatible model adapters, or default-hybrid behavior without new evidence and approval.
