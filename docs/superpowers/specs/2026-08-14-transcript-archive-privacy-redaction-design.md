# Transcript Archive Privacy Redaction Design

## Goal

Make privacy review an invariant of publishing Bastion Falls transcript archives without destroying
private evidence or making legacy audit debt so noisy that it becomes invisible.

The archive command must apply private, session-specific redaction instructions before it creates
public audio or transcript artifacts. Public archives retain only a sanitized audit receipt.
Existing unaudited public archives produce one bounded warning per archive invocation during
migration. After the legacy audit is complete, the deploy workflow fails closed if any public
archive lacks a valid receipt or violates the public archive privacy contract.

## Decisions

- Original recordings, normalized FLACs, raw ASR JSON, channel maps, alignment evidence, and private
  transcript ladders remain unchanged.
- Each private transcript session requires an ignored `redactions.yaml` before it can be archived.
- The archive command performs redaction itself; there is no separate preparation command that can
  be forgotten.
- A manifest with `reviewed: true` and empty redaction arrays records an explicit review, not an
  omitted review.
- Exact intervals, original phrases, reasons, physical-speaker identities, and replacement rules
  remain private and untracked.
- The public archive contains a sanitized `privacy-review.yaml` receipt, never the private manifest.
- Audio redaction happens on a temporary lossless FLAC snapshot before the existing Opus encoding,
  avoiding a second lossy pass.
- Declared identity-test intervals are silenced on every audio channel with short boundary fades
  while preserving duration, sample rate, channel count, and timeline.
- Publishable transcript snapshots redact declared timed events and neutralize physical-speaker
  labels. Private transcript sources are never rewritten.
- Redaction is fail closed: a missing, incomplete, invalid, or unapplied rule prevents publication.
- Legacy unaudited public archives produce one warning per archive invocation, with a count and
  remediation command. They do not generate one warning per session.
- During migration, legacy audit debt does not block a newly reviewed archive.
- Once all legacy public archives have valid receipts, CI enforcement becomes a permanent deploy
  blocker.
- The same typed validator powers local archive warnings, the audit command, and CI. The workflow
  must not duplicate the rules with shell substring checks.

## Privacy Boundary

### Private and ignored

The following remain under `.bf-transcripts/` or other private storage:

- source and normalized FLAC recordings;
- raw Whisper JSON and private transcript artifacts;
- `channel-map.yml` and physical-speaker ownership evidence;
- `redactions.yaml` with exact intervals, reasons, original text, and private labels;
- intermediate redacted FLAC and transcript snapshots, which exist only in an invocation-owned
  temporary directory.

The repository already ignores `.bf-transcripts/`. The archive implementation must verify that it
never copies `redactions.yaml` into a public destination.

### Public and tracked

A public session archive may contain:

- redacted `session-audio.opus`;
- redacted transcript ladder artifacts;
- ordinary non-sensitive provenance already allowed by the archive contract;
- sanitized `privacy-review.yaml`.

The public receipt proves that review and transformation occurred without revealing what was
removed.

## Private Manifest

The session-local path is:

```text
<session-dir>/redactions.yaml
```

Version one is strict and equivalent to:

```yaml
version: 1
reviewed: true

audio:
  - id: opening-physical-identity-check
    start: 00:00:00.000
    end: 00:00:05.250
    channels: all
    reason: physical-speaker-identity
    fadeMilliseconds: 20

transcripts:
  - id: opening-physical-identity-check
    start: 00:00:00.000
    end: 00:00:05.250
    replacement: "[microphone identity check redacted]"

speakerLabels: neutralize
```

A reviewed session with no required redactions uses:

```yaml
version: 1
reviewed: true
audio: []
transcripts: []
speakerLabels: preserve
```

### Manifest validation

The strict Zod schema rejects:

- an unsupported version;
- `reviewed` absent or not exactly `true`;
- duplicate or empty rule IDs;
- malformed, negative, zero-length, reversed, or non-finite intervals;
- intervals beyond the probed normalized-audio duration;
- overlapping audio rules unless their complete normalized transformations are identical and
  mergeable;
- any audio channel selector other than `all` in version one;
- unsupported reasons or speaker-label policy;
- empty, multiline, or identity-bearing replacement text;
- path, command, FFmpeg expression, or arbitrary-filter input from the manifest;
- unknown keys.

Version one intentionally supports only `channels: all`. Selective channel muting risks preserving
bleed or partial identity and is not needed for the August 8/9 use case.

## Archive Data Flow

For one session, `bfcli transcribe archive` performs:

1. Resolve settings and scan the public output directory for legacy audit debt.
1. Emit at most one bounded warning if any public archive is unaudited.
1. Resolve the target session and require `<session-dir>/redactions.yaml`.
1. Parse and validate the private manifest.
1. Probe `normalized/session.flac` and validate all audio intervals against its duration and stream
   shape.
1. Snapshot every source through the archive command's existing regular-file, no-symlink,
   contained-path boundary.
1. Apply all audio redactions in one FFmpeg invocation to a temporary FLAC:
   - silence both channels;
   - apply short fades at interval boundaries to avoid clicks;
   - preserve duration, sample rate, channel count, and channel layout;
   - never accept a raw filter expression from YAML.
1. Transform transcript snapshots by timestamped events:
   - replace every event overlapping a declared transcript interval with one bounded placeholder for
     that interval;
   - neutralize `[speaker:<physical-name>]` labels when requested;
   - preserve fictional-character names and ordinary dialogue outside declared intervals.
1. Verify the transformation:
   - output audio duration matches the source within one sample-frame tolerance;
   - channel count, sample rate, and layout match;
   - every declared audio and transcript rule reports at least one applied transformation;
   - no forbidden physical-speaker labels remain when neutralization is requested;
   - the private manifest is absent from the archive entry set.
1. Encode the temporary redacted FLAC directly to Opus using the existing bitrate setting.
1. Generate a sanitized public receipt.
1. Publish the complete archive atomically through the existing replacement path.
1. Remove invocation-owned temporary audio, transcript, and receipt files in `finally`.

Any failure before atomic publication leaves original sources and any previous public archive
unchanged.

## Transcript Transformation

The archive currently publishes several optional transcript stages. The same transformation is
applied independently to every Markdown transcript selected for the archive:

- `raw_transcript.md`;
- `corrected_transcript.md`;
- `reconciled_transcript.md`;
- any future transcript entry explicitly classified as publishable dialogue.

Correction notes and review notes are not dialogue transcripts. They are scanned for forbidden
physical-speaker metadata and either sanitized by an explicit typed policy or rejected. The
implementation must not blindly replace every occurrence of a participant name because legitimate
fictional or contextual uses may exist.

### Timed redaction behavior

A transcript rule operates on parsed timestamped events, not global text substitution. Every event
overlapping the interval is removed. One replacement event is emitted at the union interval using
the manifest's bounded public placeholder.

A rule that matches no timestamped event fails the archive. This prevents a typo in a timestamp from
creating a plausible but ineffective receipt.

### Physical-speaker labels

`speakerLabels: neutralize` transforms physical labels into stable non-identifying labels derived
from public-safe channel evidence, such as:

```text
[speaker:left]
[speaker:right]
```

If a transcript event cannot be mapped to a public-safe neutral label, its physical-speaker label is
removed. The archive never emits the private channel map or a label-to-person legend.

## Public Receipt

The archive writes `privacy-review.yaml` with a strict, public-safe shape such as:

```yaml
version: 1
reviewed: true
policy: transcript-archive-privacy-v1
audioRedactionsApplied: 1
transcriptRedactionsApplied: 1
speakerLabels: neutralized
```

The receipt contains no:

- participant names or account identifiers;
- rule IDs that disclose a reason or person;
- timestamps or durations of individual redactions;
- original or replacement phrases;
- channel-to-person mappings;
- local paths;
- source hashes that identify private files.

Counts are aggregate transformation counts. They exist to distinguish an intentionally empty review
from an archive that claimed redaction without applying it.

## Legacy Audit

### Inventory

At design time, `astro/src/assets/transcripts/` contains 13 public session directories and none
contains a privacy receipt:

- 2026-05-16;
- 2026-05-22;
- 2026-05-23;
- 2026-05-29;
- 2026-05-30;
- 2026-06-06;
- 2026-06-07;
- 2026-06-13;
- 2026-06-14;
- 2026-06-20;
- 2026-06-21;
- 2026-06-27;
- 2026-06-28.

August 8 and August 9 are the first known sessions with deliberate physical-identity microphone
checks. Older archives therefore require an evidence-based audit, not assumed redaction.

### Audit command

The CLI adds a read-only command:

```text
bfcli transcribe archive audit
```

It scans the configured public archive output directory and reports:

- total public archive directories;
- audited archives with valid receipts;
- unaudited archives;
- invalid receipts;
- archives containing structurally identifiable physical-speaker labels such as
  `[speaker:Nico]`, rather than public-safe channel labels;
- a concise list of affected session names.

The default human output is concise. A machine-readable mode may be added for CI if the existing
command framework requires it, but both modes call the same typed audit function.

The audit command does not infer that an old archive is safe merely because name-like text is
absent. Human review produces the receipt. Automated scanning is supporting evidence, not consent or
semantic proof.

### Bounded warning

Every archive invocation performs the public audit once. If debt exists, it writes one warning to
stderr before processing:

```text
Warning: 13 public transcript archives have not completed privacy audit.
Run `pnpm bfcli transcribe archive audit` for details.
```

Rules:

- one warning block per invocation;
- no per-session warning cascade under `--all`;
- no warning when debt is zero;
- count and remediation command always present;
- warning does not block a currently valid, reviewed session during migration;
- invalid receipts and confirmed forbidden metadata are described distinctly from merely missing
  receipts.

## CI And Deployment Enforcement

### Migration phase

The deploy workflow does not immediately block on the 13 known missing receipts. Local archive
commands still fail closed for every newly published session, and the warning keeps legacy debt
visible.

The audit work backfills one sanitized receipt per older public archive after human review and any
required scrub. Receipt commits are reviewable public evidence that the archive was checked, not a
disclosure of private findings.

### Enforcement phase

After all legacy archives have valid receipts, `.github/workflows/deploy.yml` runs the reusable
privacy audit before the Astro build:

```text
pnpm bfcli transcribe archive audit --require-complete
```

`--require-complete` exits nonzero when:

- any public archive lacks a valid receipt;
- any receipt uses an unsupported policy/schema;
- any public archive contains `redactions.yaml` or another private instruction artifact;
- any transcript contains a physical-speaker label that is not one of the policy's closed
  public-safe channel labels;
- the receipt and public artifact set are structurally inconsistent.

This becomes a permanent publication blocker. There is no workflow-only bypass flag. Emergency
override, if ever needed, requires an explicit reviewed repository change rather than an unlogged
CLI option.

CI does not attempt generic real-name or PII detection. It has no private identity map and cannot
replace human semantic review. It enforces receipts, artifact structure, absence of private
instructions, and the closed syntax of public-safe speaker labels.

The check runs before build and deploy so privacy failure prevents publication rather than merely
reporting after deployment.

## Failure Handling

- Missing private manifest: fail with its expected absolute path and a minimal reviewed-empty
  template hint.
- Invalid private manifest: fail with field-specific validation errors without echoing private
  values unnecessarily.
- Missing normalized audio or required transcript: retain existing archive errors.
- Audio rule applies outside probed duration: fail before FFmpeg.
- FFmpeg redaction or probe failure: fail and publish nothing.
- Transcript rule matches nothing: fail and publish nothing.
- Physical label remains after neutralization: fail and identify only the artifact and line number,
  not the private label in ordinary output.
- Existing destination without `--force`: retain existing behavior.
- Replacement failure under `--force`: retain existing backup/restore behavior.
- Audit warning scan failure: fail the archive rather than silently skipping a privacy control.

## Testing And Verification

### Focused behavior tests

Use RED/GREEN coverage for these stable privacy contracts:

- strict private-manifest parsing, reviewed-empty acceptance, and malformed interval rejection;
- archive refusal when `redactions.yaml` is missing;
- one warning per invocation for legacy debt, including `--all`;
- no warning when debt is zero;
- transcript event redaction and physical-label neutralization;
- fail-closed behavior when a transcript rule applies zero times;
- public receipt generation with no private fields;
- archive entry set excludes `redactions.yaml`;
- audit classification of valid, missing, invalid, and forbidden-metadata archives;
- `--require-complete` success and failure exit behavior.

### Real audio integration proof

A bounded synthetic stereo FLAC proves the actual FFmpeg boundary:

1. generate known audio tones plus speech-like signal across a declared interval;
1. run the redaction helper;
1. probe source and output stream shape and duration;
1. measure the redacted interval on both channels to confirm silence;
1. measure neighboring windows to confirm unrelated audio remains;
1. encode the redacted FLAC through the existing Opus helper.

For August 8 and 9, create private manifests only after exact interval review. Before public archive
publication:

- hash originals and normalized sources;
- run archive redaction;
- verify source hashes remain unchanged;
- inspect and listen to padded redaction boundaries;
- confirm no name fragments survive;
- inspect public transcript starts and physical-label scans;
- inspect the final public receipt and archive entry list.

### Project gates

Run at the stable implementation milestone:

```text
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
pnpm -F @bastion-falls/astro build
pnpm bfcli transcribe archive audit
pnpm bfcli transcribe archive audit --require-complete  # after legacy backfill only
git diff --check
```

The first audit is expected to report migration debt until all 13 historical archives are reviewed.
The enforcement command must not be added to deploy CI until that debt is actually zero.

## Rollout

1. Implement typed manifests, audio/transcript transformation, sanitized receipts, and the read-only
   audit command.
1. Require private manifests for all new archive calls.
1. Create and manually verify private August 8 and August 9 manifests.
1. Archive August 8 and 9 only through the privacy-aware command.
1. Audit the 13 legacy archives, scrub only where evidence requires it, and add sanitized receipts.
1. Confirm `archive audit --require-complete` passes locally with zero debt.
1. Add the same command before build in `.github/workflows/deploy.yml`.
1. Keep the CI blocker permanent for future public archive changes.

## Out Of Scope

- Destructive editing of original recordings or private transcript evidence.
- Publishing private redaction manifests or identity intervals.
- Biometric voice identification.
- Generic personally identifiable information detection across arbitrary prose.
- Automatically deciding whether historical dialogue is consented or safe.
- Rewriting public Git history for already-published archives.
- Selective single-channel identity muting in version one.
