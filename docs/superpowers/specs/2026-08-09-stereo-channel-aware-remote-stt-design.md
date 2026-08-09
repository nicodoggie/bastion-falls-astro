# Stereo Channel-Aware And Remote STT Design

## Goal

Preserve stereo recording evidence throughout audio preparation, use explicit session channel
metadata to improve physical-speaker attribution and transcription correction, and allow the
transcription pipeline to select named local or OpenAI-compatible remote STT targets without
changing the existing local Whisper default.

The smallest complete loop is:

> Prepare a stereo session into one durable normalized stereo master plus reproducible channel
> derivatives, transcribe either the conversation alone or a bounded hybrid stereo/channel pass,
> reconcile channel evidence into an attributed transcript, and resume the same session against a
> named local or remote STT target.

## Decisions

- The untouched source remains the capture master and is never overwritten.
- Normalization preserves stereo. It must not collapse a stereo source to mono.
- The pipeline writes both a normalized stereo master and per-channel mono derivatives.
- The archive keeps the existing compact-audio behavior: it encodes the normalized stereo master as
  stereo Opus at the configured bitrate. It does not retain the FLAC master, reproducible channel
  derivatives, or chunk audio.
- Stereo normalization occurs before channel splitting so relative channel dominance is not
  destroyed by independent loudness normalization.
- Every transcription layout uses one shared logical chunk plan and identical time boundaries.
- The default transcription layout remains one conversational stereo pass.
- Hybrid transcription is opt-in through a named `.bfcli.yml` profile and runs three aligned passes:
  stereo, left channel, and right channel.
- Hybrid execution is selectable per chunk so its quality and compute cost can be measured before a
  full-session run.
- A versioned, session-specific YAML file is the source of truth for channel-to-physical-speaker and
  partial physical-speaker-to-character mappings.
- Channel metadata identifies a physical speaker, not automatically the character they are
  portraying.
- Physical-speaker attribution may be emitted when channel evidence and mapping make it unambiguous.
  Character attribution remains unknown unless supported by session evidence.
- An OpenAI-compatible `/audio/transcriptions` target is the first remote provider.
- Named targets are explicit and provenance-bearing. A selected target never silently falls back to
  a different provider or model.
- Existing local `nodejs-whisper` behavior remains the default and independently testable.
- `transcribe prepare` is a friendly alias for the generic stage cutoff used to stop after audio
  chunking.
- The final human review loop remains part of the workflow. Automation removes mechanical
  transcription and attribution work; it does not eliminate collaborative canon review.

## Scope

### Included

- Stereo-safe normalization and channel probing.
- Stereo master plus per-channel mono derivative generation.
- Shared chunk planning and paired channel chunk generation.
- Versioned Zod schemas for channel maps, transcription profiles, and STT targets.
- A CLI command that scaffolds a parseable session channel-map YAML file.
- Partial physical-speaker and expected-character mappings.
- Named local and OpenAI-compatible remote STT targets.
- Default stereo and opt-in hybrid transcription layouts.
- Bounded chunk selection for quality and compute experiments.
- Separate cached artifacts for stereo and channel passes.
- Timestamp alignment, conservative bleed handling, and physical-speaker attribution.
- Channel evidence supplied to correction and review stages.
- Resume/checkpoint semantics for prepared and partially transcribed sessions.
- Archive provenance updates while excluding reproducible working audio.

### Deferred

- Learned voice embeddings or biometric voice identification.
- Automatic enrollment from reference voice samples.
- Automatic character identification based only on vocal performance.
- Adaptive execution that decides dynamically which chunks deserve channel passes.
- A purpose-built Bastion Falls STT server protocol.
- Remote file-copy/SSH execution as an STT provider.
- OpenAI-incompatible model adapters. Each future provider must be an explicit opt-in adapter and
  must not alter the default Whisper path.
- Changing hybrid transcription into the default before measured acceptance.
- Long-term storage of mono derivatives or channel chunk audio.

## Configuration Model

### Transcription profiles

`.bfcli.yml` contains named profiles that select a transcription layout and named target together.
The ordinary path requires no new flags.

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
      # apiKeyEnv: M1_STT_API_KEY
```

The schema supports these version-one target providers:

- `nodejs-whisper`;
- `faster-whisper`;
- `openai-compatible`.

A profile layout is either:

- `stereo`: one conversational pass from the normalized stereo master; or
- `hybrid`: one stereo conversational pass plus one pass for each configured channel.

The existing backend/model CLI flags remain backward-compatible. The documented configuration path
is a profile, and `--profile <name>` is the single profile override for experiments.

### Configuration validation

Zod schemas validate the `transcribe.profiles` and `transcribe.targets` sections after `.bfcli.yml`
is loaded. TypeScript types are derived with `z.infer`; no parallel handwritten interfaces duplicate
the schema.

Validation rejects:

- an unknown default profile;
- a profile referencing an unknown target;
- an unsupported provider or layout;
- missing provider-specific fields;
- invalid URLs, timeout values, retry counts, or environment-variable names;
- remote credentials embedded as literal secret values.

Only the environment-variable name may be configured. The resolved secret value is never written to
logs, manifests, checkpoints, comparison artifacts, or archives.

## Session Channel Map

### Location and command

The default session channel map lives inside the transcript session directory as
`channel-map.yml`. An explicit path may be supplied when needed.

The scaffold command is:

```text
bfcli transcribe channels init <audio> --campaign <slug> --session-date <YYYY-MM-DD>
```

It probes the source, resolves the normal session output directory, writes a reviewable starter
file, and refuses to overwrite an existing map unless explicitly forced.

### Versioned schema

The YAML is validated by strict Zod schemas. The object shape is equivalent to:

```yaml
version: 1
source: /path/to/session.wav
channels:
  - id: left
    index: 0
    speakers:
      - name: Nico
        role: gm
        expectedCharacters:
          - name: Andrew Taminok
            aliases: []
    notes: GM and NPC voices; may be audible as bleed on right.

  - id: right
    index: 1
    speakers:
      - name: Regular player
        role: player
        expectedCharacters:
          - name: Philippa
            aliases: []
          - name: Minfilia
            aliases: []
    notes: Player portrays several PCs, including the Legally Bare girls.
```

The scaffold leaves speaker and character arrays empty. Nico may partially complete them before or
after audio preparation.

The schema owns these invariants:

- supported schema version;
- unique channel IDs and indexes;
- nonnegative channel indexes;
- nonempty names and aliases when present;
- known physical-speaker roles;
- unique expected-character names and aliases within their relevant scope;
- partial mappings are valid;
- no character identification is required merely because a physical speaker is known.

The scaffold builds a typed object, validates it through the same Zod schema, then serializes it.
All downstream code consumes only parsed schema output.

## Audio Preparation

### Source probing

Before normalization, the pipeline uses `ffprobe` to record:

- stream count;
- channel count and layout;
- sample rate;
- duration;
- source fingerprint sufficient to invalidate stale artifacts.

A mono source remains valid for the default stereo/conversational layout, preserving existing
behavior. Selecting hybrid against a source without the required channels fails before STT with a
clear message.

### Normalized artifacts

For a stereo source, preparation writes:

```text
normalized/
  session.flac
  channels/
    left.flac
    right.flac
```

`normalized/session.flac` is the durable normalized stereo master. It retains two channels and uses
the speech-oriented sample rate and filters already owned by the pipeline, except that it no longer
forces `-ac 1`.

The channel derivatives are split from the already normalized stereo master. They do not receive
separate loudness normalization. This preserves relative channel dominance so bleed can be compared
rather than accidentally amplified.

### Shared chunk plan

Silence detection and chunk planning operate once against the normalized conversational master.
Every pass uses the resulting logical chunk boundaries and overlap windows.

Working audio is arranged by pass:

```text
chunks/
  stereo/
    session_000.flac
  channels/
    left/
      session_000.flac
    right/
      session_000.flac
```

The manifest records the normalized stereo path, channel derivative paths, channel metadata path,
shared chunk plan, audio settings, and source fingerprint. It does not contain secrets.

## Stage Control And Resume

### Friendly preparation command

`transcribe prepare` invokes the same pipeline as `transcribe run`, with a stage cutoff after audio
chunking. It does not fork a second normalization implementation.

### Generic cutoff

`transcribe run --stop-after <stage>` provides the underlying stage boundary. Version one supports
cutoffs at least after:

- normalization;
- audio chunking;
- transcription;
- raw transcript assembly;
- correction/review;
- notes.

`prepare` is equivalent to the audio-chunking cutoff.

### Bounded chunk selection

A chunk selector accepts:

- one chunk, such as `0`;
- a range, such as `0-2`;
- a comma-separated selection, such as `0,4,7`.

When omitted, all planned chunks are eligible. Selection limits STT and downstream assembly work; it
does not rebuild audio preparation artifacts.

A bounded run records only the selected completed passes. It never marks the whole transcription
stage or workflow complete unless every required chunk and pass for the selected profile is
complete.

### Cache identity

Reusable STT artifacts are keyed by at least:

- source fingerprint;
- normalized audio and chunking settings;
- pass/channel identity;
- target provider;
- model;
- language and provider-owned transcription parameters.

Changing only speaker or expected-character metadata reuses audio and STT results. It invalidates or
reruns attribution, assembly, correction, review, and notes where their inputs changed.

## STT Targets

### Local targets

The existing local providers retain their current implementations and defaults. Profile resolution
adapts the named target into those existing provider option types rather than duplicating local
model execution.

### OpenAI-compatible remote target

The remote adapter submits each chunk to the configured base URL's `/audio/transcriptions` endpoint
as a multipart request. It requests a verbose timestamped response and normalizes returned segments
into the existing `ChunkTranscript` domain.

The request includes only provider-supported transcription fields owned by the target contract,
including model, language when fixed, and the established campaign transcription prompt when the
server supports prompts.

Timeout and retry behavior is bounded by target configuration. Retry applies only to transient
transport/server failures. Validation errors and incompatible responses fail immediately with the
target name and chunk identity.

A named target failure never falls back to another target. Completed chunks remain cached, and the
run can resume after the remote service recovers.

## Hybrid Transcription And Alignment

### Three aligned passes

For every selected chunk, hybrid mode may produce:

```text
raw_chunks/
  stereo/session_000.json
  channels/left/session_000.json
  channels/right/session_000.json
```

The stereo pass is the primary conversational-context transcript. Channel passes are evidence for
cleaner wording and physical-speaker attribution.

### Alignment

The merger converts every segment to global session time and aligns candidates using conservative
time overlap and normalized text similarity. It also derives relative per-channel energy for aligned
speech windows from the stereo evidence.

The merge rules are:

1. Preserve the stereo segment as the primary text when an aligned conversational segment exists.
1. Attach left/right alternatives and confidence/energy evidence rather than silently replacing text
   during deterministic assembly.
1. Include a channel-only segment when no reasonable stereo candidate covers it.
1. Collapse clear cross-channel bleed duplicates into one event.
1. Keep materially different simultaneous speech as separate overlapping events.
1. Attribute the physical speaker only when one channel is dominant and the channel map is
   unambiguous.
1. Leave the physical speaker unknown when evidence conflicts or a channel maps to multiple possible
   people.
1. Never infer a performed character solely from channel identity.

The alignment artifact remains inspectable so correction decisions have provenance.

### Transcript labels

Raw, corrected, and reconciled transcript artifacts preserve physical-speaker/channel labels. A
representative line is conceptually:

```text
[00:15:21 - 00:15:25] [channel:left] [speaker:Nico] The Monadists followed the One Way.
```

Character attribution is optional and evidence-bound. When unsupported it remains absent rather than
being filled with a likely roster entry.

Generated campaign notes use attribution to understand who performed an action or line, but omit
technical channel labels from ordinary prose.

## Correction And Review Context

Correction and review receive:

- the stereo conversational text;
- aligned channel alternatives;
- authoritative physical-speaker/channel labels;
- the session channel map;
- expected-character rosters as possibilities, not facts;
- existing glossary and correction rules;
- rolling campaign context.

Prompts explicitly require the model to:

- preserve physical-speaker/channel labels;
- use cleaner channel evidence when resolving likely STT mistakes;
- keep original language and conversational order;
- distinguish physical speaker from portrayed character;
- avoid assigning a character merely because that character appears in the speaker's roster;
- retain uncertainty when evidence does not settle a name or portrayal.

Character names inferred during correction must be supported by dialogue or campaign evidence and
remain reviewable. The final Nico/Ran review remains the canon-promotion gate.

## Checkpoint And Manifest Evolution

The checkpoint format evolves to represent pass-level progress. It records:

- normalization completion and stereo master path;
- channel derivative completion and paths;
- shared audio chunking completion;
- required transcription passes for the selected profile;
- completed chunk indexes per pass;
- alignment/assembly completion;
- correction/review and notes completion;
- whether a run was bounded to selected chunks.

Older version-one checkpoints and manifests must either migrate through a narrow compatibility
parser or fail with an explicit instruction to rebuild. They must not be misread as
stereo/channel-aware state.

## Archive Contract

The current archive does not store the normalized FLAC directly. It reads `normalized/session.flac`,
encodes `session-audio.opus` with `libopus` at the configured bitrate (currently 32 kbit/s by
default), and places that compact audio in the archive. The `.opus` output is Ogg Opus, not Ogg
Vorbis. This behavior remains unchanged except that the encoded audio must now preserve both stereo
channels.

The archive retains:

- a stereo Opus rendering of the normalized stereo master;
- raw source-independent manifest and checkpoint provenance;
- channel-map YAML when present;
- raw stereo and channel STT JSON/Markdown artifacts;
- alignment/comparison evidence;
- assembled, corrected, and reconciled transcripts;
- correction/review notes and campaign notes according to existing archive rules;
- shared correction rules according to existing archive rules.

The archive omits:

- normalized left/right FLAC derivatives;
- stereo and channel chunk FLAC files;
- credentials or resolved API keys.

The omitted channel audio is reproducible before archiving from the normalized stereo master and
manifest settings. The archive's compact Opus rendering is the retained long-term audio artifact.

## Failure Behavior

- A requested stereo/hybrid layout against insufficient source channels fails before STT.
- Invalid channel-map YAML fails with path-aware Zod diagnostics.
- An absent channel map does not block default stereo transcription.
- A partial channel map allows channel-only or partial physical-speaker labels.
- A missing named profile or target fails before audio or network work.
- Remote timeout, exhausted retry, malformed response, or unsupported timestamp response identifies
  the target and chunk, preserves completed work, and leaves the run resumable.
- The pipeline never silently mixes providers, models, or profiles in one apparently uniform pass.
- Existing outputs with incompatible source fingerprints or settings are not reused.
- A bounded chunk run never claims full workflow completion.
- Archive creation fails rather than silently omitting the normalized stereo source or its encoded
  Opus artifact.

## Efficient Verification Ledger

Every owned invariant has one primary evidence layer.

| Owned contract or distinct failure                                                                     | Cheapest convincing evidence                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stereo remains stereo; channel derivatives are aligned mono; the louder source side remains louder     | One real `ffmpeg`/`ffprobe` integration test with a generated short asymmetric stereo signal. Assert channel counts, equal duration, and relative rather than exact loudness. |
| Channel-map schema accepts useful partial data and rejects dangerous conflicts                         | Small Zod parser tests: one minimal partial mapping and one duplicate/conflicting channel mapping.                                                                            |
| Scaffold matches probed channels and emits valid YAML                                                  | One scaffold round-trip test: probe synthetic fixture, scaffold, parse with the authoritative schema.                                                                         |
| Named remote target sends a compatible request and parses timestamped segments                         | One local mock-server contract test covering the multipart happy path.                                                                                                        |
| Remote failure is bounded and never silently falls back                                                | One failure test covering a transient retry followed by explicit target/chunk failure.                                                                                        |
| Hybrid alignment preserves conversational text, handles bleed, and avoids unsupported character claims | One table-driven pure test containing a clean event, duplicate bleed, disagreement, overlapping speech, physical attribution, and unknown character attribution.              |
| Prepare, bounded execution, and resume share one implementation and do not claim false completion      | One lifecycle integration test using injected fake process/STT runners rather than a real model.                                                                              |
| Archive encodes stereo Opus from the stereo master and omits reproducible derivative audio             | Extend the existing archive-plan and Opus-argument tests with direct stereo-source and inclusion/exclusion assertions.                                                        |

The routine test suite does not:

- download or run a real Whisper model;
- contact the actual M1;
- assert exact ffmpeg amplitudes or implementation-specific command strings when artifact inspection
  is stronger;
- duplicate `prepare` and `--stop-after audio-chunking` behavior in separate suites;
- test every Stricli spelling owned by the framework;
- build Astro or run root-wide tests for a CLI-only change.

Implementation verification runs focused transcribe tests while iterating, then one CLI typecheck,
one full CLI test run, and one CLI build after the effective diff is stable.

## Manual Acceptance Benchmark

The current stereo D&D recording is manual acceptance evidence, not a permanent repository fixture.
For one selected logical chunk:

1. prepare the stereo master and channel derivatives;
1. run the default stereo pass;
1. add the two hybrid channel passes without rerunning the stereo pass;
1. inspect aligned output and attribution;
1. compare obscure-name pickup, cross-channel context, speaker attribution, elapsed time, and remote
   resource use;
1. decide whether hybrid deserves wider use for the session.

Success does not require hybrid to win. A measured result that single-pass stereo is sufficient is a
valid outcome and prevents unnecessary compute from becoming the default.

## Acceptance Criteria

- A stereo source produces a normalized stereo `session.flac` and aligned mono channel derivatives.
- Normalization and chunking do not flatten stereo evidence.
- `transcribe prepare` stops after the same audio-chunking implementation used by `run`.
- The generic cutoff and bounded chunk selector leave truthful resumable checkpoints.
- The scaffold command emits Zod-valid partial channel-map YAML.
- Physical speakers and expected characters remain distinct concepts throughout the pipeline.
- Default configuration performs one conversational transcription pass with the current local
  Whisper path.
- A named hybrid profile performs aligned stereo, left, and right passes only for selected/missing
  chunks.
- A named OpenAI-compatible target transcribes chunks remotely with bounded timeout/retry and
  explicit provenance.
- Hybrid output preserves conversational context, provides inspectable channel alternatives, handles
  clear bleed conservatively, and avoids unsupported character attribution.
- Correction/review can use channel evidence and partial character mappings without converting
  possibilities into canon.
- Archive output retains a stereo Opus rendering of the normalized master and transcript provenance
  while excluding the FLAC master and reproducible derivative/chunk audio.
- Focused tests, CLI typecheck, CLI tests, and CLI build pass.

## Stop Rule

Stop when the acceptance criteria above pass. Do not add voice embeddings, automatic speaker
enrollment, adaptive chunk selection, a custom remote server, SSH transport, non-OpenAI model
adapters, or default-hybrid behavior without fresh approval and measured evidence.
