# Unified Transcript Reconciliation Design

## Goal

Replace the inference-heavy pre-summarization transcription path with one evidence-aware
reconciliation invocation per logical chunk. The new reconciler produces a readable, auditable
transcript; a structurally identical summary-safe derivative; attribution metadata; and a durable
review queue.

The readable reconciliation should resemble actual dialogue and narration rather than a sequence of
one-word ASR segments. It may merge adjacent fragments, repair punctuation and grammar, remove
decoder loops and accidental duplication, and distinguish overlapping speech. It must preserve
meaningful repetition, interruption, uncertainty, chronology, language, and primary evidence.

After the single-chunk path is verified, benchmark it against a three-chunk inference window using
the same per-logical-chunk output contract. Do not automatically promote benchmark output into
canonical session artifacts.

## Current Problem

For each transcript chunk, the current pre-summarization flow may invoke models for:

1. literal Codex correction;
1. rolling correction context;
1. correction notes;
1. Hermes evidence reconciliation;
1. summary-safe cleanup.

Only then does hierarchical summarization begin. Several calls reread derivatives without receiving
new evidence. The final cleanup pass can also become a destructive rewrite: the August 9 run
produced a finalized summary-safe chunk that retained only about 35 percent of the reconciled text.

The current filesystem layout mirrors this inference history with separate per-chunk directories for
corrected text, correction context, correction notes, reconciliation, review notes, summary-safe
text, and summarization intermediates. The August 9 working session reached 951 files. The latest
August 16 working session has 702 files, including 217 JSON/YAML files that are mostly coherent
pass- and alignment-keyed evidence. The avoidable file growth is in duplicate downstream
representations.

## Scope

This design owns:

- the post-alignment, pre-summarization reconciliation contract;
- readable transcript restructuring and evidence accounting;
- summary-safe derivation in the same inference response;
- physical-speaker and character-attribution handling;
- review metadata and post-summary correction provenance;
- a lean canonical artifact layout;
- consolidation of chunk summarization and rolling-context inference;
- public transcript projection;
- the August 15 single-chunk versus three-chunk benchmark.

It does not change audio preparation, STT provider behavior, pass-keyed raw artifact custody, hybrid
alignment thresholds, archive audio redaction mechanics, shared correction-rule promotion policy, or
the collaborative human campaign-review loop.

## Pipeline

The production path becomes:

```text
audio
  -> prepared stereo/channel passes
  -> STT artifacts
  -> deterministic hybrid alignment
  -> unified reconciliation
      -> readable reconciled transcript
      -> summary-safe derivative
      -> attribution and evidence metadata
      -> review queue
  -> hierarchical summarization
  -> authored session note
```

Raw STT, channel-pass outputs, alignment alternatives, the joined raw transcript, and original audio
remain primary evidence. The former Codex literal correction is an intermediate model opinion, not
primary evidence, and is removed from new runs.

Historical `corrected_transcript.md` and related directories remain readable. New runs must not
write the readable reconciliation under `corrected_transcript.md`, because that would falsely claim
the old literal-correction provenance layer still exists.

## Reconciliation Unit

Production uses one Hermes invocation per owned logical chunk. Each invocation receives:

1. the current chunk's complete aligned evidence;
1. the tail of the previous validated readable chunk, when available;
1. the head of the next aligned chunk, when available;
1. the glossary and applicable shared correction rules;
1. the channel map, physical speakers, and expected-character hints;
1. campaign and session-date context;
1. read-only repository retrieval;
1. the exact logical start and end owned by the output.

Neighboring text is context only. The response may not emit events outside the owned logical window.
This prevents joined-output duplication while allowing cross-boundary sentence and turn recovery.

A deterministic evidence-packet builder assigns stable source-event IDs and prepares this input. It
performs no model inference.

## Readable Transcript Contract

The readable reconciliation is the canonical corrected transcript for new runs. It may:

- merge adjacent ASR fragments into natural timestamped utterance or narration blocks;
- combine fragments across overlapping stereo/channel hypotheses when they represent one utterance;
- preserve distinct simultaneous utterances as overlapping blocks;
- repair punctuation, capitalization, morphology, and obvious ASR word errors;
- remove decoder loops, accidental duplicate hypotheses, and abandoned false starts;
- retain meaningful repetition, hesitation, interruption, code-switching, jokes, and uncertainty;
- use repository evidence and confirmed correction rules for supported names and lore terms.

It may not summarize events, silently reorder speech, invent connective events, assign unsupported
characters, turn new improvisation into a continuity error, translate Tagalog into English, or
collapse distinct overlapping speech into synthetic prose.

## Canonical Reconciliation Schema

The model returns one strict, versioned structured response. Canonical per-chunk JSON contains:

- schema and prompt versions;
- logical chunk identity and owned time range;
- cache/input identity;
- ordered readable blocks;
- summary-safe text paired to those same blocks;
- source-event accounting;
- omission records;
- material correction records;
- attribution metadata;
- suspicion flags;
- review notes.

Each readable block contains:

- a stable block ID;
- start and end timestamps;
- kind: `dialogue`, `narration`, or `unclear`;
- readable reconciled text;
- summary-safe text;
- optional channel attribution;
- optional private physical-speaker attribution;
- optional character candidate;
- character confidence: `confirmed`, `probable`, or `unknown`;
- a bounded attribution basis;
- source alignment-event IDs;
- block-level review flags.

The summary-safe text is not a separate structure. It must retain the block ID, timestamps, kind,
attribution, order, and source accounting of its readable counterpart. Only wording needed for
summary-model compatibility may differ.

Normal punctuation, capitalization, and fragment joining do not need correction records. Material
name/lore substitutions and character attributions do.

## Evidence Accounting

Every source alignment event inside the logical window must be accounted for exactly once:

- consumed by one readable block; or
- recorded in the omission ledger.

An omission includes its source-event ID, original text, timestamps, and one bounded reason:

- `decoder-loop`;
- `duplicate`;
- `false-start`;
- `non-speech`;
- `unintelligible`;
- `outside-logical-window`.

No nonexistent or neighboring-window event may be claimed. Consumed events must fit inside the
rendered block's supported time range. Alignment artifacts retain every original stereo/channel
alternative, confidence, energy measurement, and physical-speaker decision unchanged.

This gives post-summary correction chats a referential evidence ladder:

```text
final note claim
  -> scene-summary claim
  -> chunk-summary claim
  -> reconciled block
  -> source alignment events and alternatives
  -> raw STT segment
  -> original audio range
```

The readable transcript is the convenient review starting point. Raw/alignment/audio evidence
remains the correction authority. The summary-safe transcript is never correction evidence.

## Speaker And Character Attribution

Physical-speaker attribution remains evidence-based. It requires valid independent-channel
provenance, exact-window relative-energy dominance, and an unambiguous session channel map. Private
working transcripts may show physical speaker names.

Character identity is a separate inference. The expected-character list is a candidate set only and
cannot prove attribution. The reconciler may use explicit narration, dialogue context, scene
context, physical-speaker evidence, and expected-character hints to return:

- `confirmed`: directly supported by explicit transcript or scene evidence;
- `probable`: a reasoned but uncertain character attribution;
- `unknown`: insufficient evidence or likely out-of-character speech.

GM narration may use `GM`. GM-controlled NPC attribution should abstain unless surrounding evidence
supports a specific character. Player speech must distinguish in-character dialogue from out-of-
character/table speech where possible.

Private structured artifacts retain physical speaker, character candidate, confidence, and basis.
Public projection removes physical identities but may publish character guesses when confidence is
visible.

## Review States

A chunk has one of three statuses:

- `valid`: all hard gates pass with no suspicion flags;
- `needs_review`: all hard gates pass, but one or more valid transformations deserve review;
- `invalid`: structural or evidence-accounting validation fails.

`needs_review` is nonblocking. Its block-level flags remain in canonical JSON and flow into
summarization. `invalid` blocks cannot feed summarization.

Useful suspicion flags include:

- unusually high omitted unique-text or audio-duration ratio;
- large compression unexplained by duplicate/loop evidence;
- long ranges classified entirely as decoder loops;
- character attribution based only on expected-character membership;
- proper nouns absent from source text and cited evidence;
- blocks spanning unexplained silence;
- reordered source events.

Real decoder loops can be large, so suspicion thresholds are triage signals rather than universal
hard failures.

The notes stage may assign one durable downstream disposition without deleting the original flag:

- `carried_as_uncertain`;
- `not_material_to_notes`;
- `resolved_for_summary`;
- `requires_human_review`.

A summary-level resolution does not mutate or silently supersede the reconciled transcript.

## Validation

A reconciliation chunk passes hard validation only when:

- the versioned response schema parses strictly;
- all block IDs are unique;
- every owned source event is consumed or omitted exactly once;
- no unknown or neighboring event is referenced;
- timestamps are finite, ordered, inside the logical window, and source-supported;
- genuine overlapping blocks are preserved rather than rejected as out of order;
- omissions use allowed reasons and retain source identity/text/time;
- material corrections retain source form, replacement, and evidence;
- character labels have a confidence class and basis;
- readable and summary-safe structures correspond exactly;
- rendered transcript tiers are nonempty.

The pipeline must not rely only on a prompt instruction such as "do not summarize or omit."

## Transactional Writes And Resume

For each chunk:

1. preserve raw Hermes output in a temporary or diagnostic location;
1. parse and validate the complete response;
1. atomically write canonical reconciliation JSON;
1. render derived human-readable output deterministically;
1. advance the checkpoint only after the canonical artifact validates.

A crash cannot leave a plausible partial file marked reusable.

Failure behavior:

- malformed whole response: preserve diagnostics, write no canonical output, and fail that chunk;
- valid readable reconciliation with invalid summary-safe text: retain canonical readable/review
  data, leave only summary safety pending, and run a bounded fallback sanitizer for that chunk;
- failed summary-safe fallback: require an explicit recorded bypass before summarizing readable
  text;
- uncertain character attribution: emit `unknown`; never block transcript completion;
- Hermes/tool failure: resume from the first missing or invalid chunk;
- invalid source accounting: stop that chunk before summarization.

A reusable artifact identity includes:

- schema and prompt version;
- source/alignment hashes;
- logical-window and neighbor-context hashes;
- channel-map hash;
- glossary and correction-rule hashes;
- campaign and session date;
- provider/profile identity;
- repository evidence revision, including relevant dirty authored evidence.

Archive-only redaction changes rerender public artifacts without rerunning reconciliation. Speaker
or character-hint changes invalidate reconciliation and downstream summaries, but not STT or
alignment.

## Lean Artifact Layout

Use one new per-chunk canonical family:

```text
reconciliation/
  session_000.json
  session_001.json
  ...
```

Each file includes readable text, summary-safe text, attribution, evidence accounting, omissions,
flags, and review notes. Do not create separate per-chunk Markdown directories for reconciliation,
summary safety, Hermes notes, correction notes, or rolling correction context.

Generate only these joined human-readable derivatives:

```text
reconciled_transcript.md
summary_transcript.md
reconciliation_review_queue.md
```

`checkpoint.json` tracks completion and cache identity; do not add a duplicative reconciliation
index. `review-corrections.yaml` remains the optional human-approved correction/disposition ledger.
`redactions.yaml` remains the reviewed publication boundary. `manifest.json` remains audio/chunk
truth.

For a 53-chunk session, the old correction stack creates roughly 159 per-chunk files before later
reconciliation. The unified stage creates 53 canonical JSON files and three joined derivatives.

## Summarization

Summarization consumes canonical reconciliation JSON rather than reparsing joined Markdown. Each
chunk receives:

- readable and summary-safe text;
- character attribution and confidence;
- applicable review flags;
- bounded raw/alignment alternatives for flagged blocks;
- prior rolling campaign context;
- campaign context and correction rules.

The ordinary summarization input is summary-safe text. The model may consult readable text where
neutralization could affect meaning.

Collapse the current chunk-summary and rolling-context calls into one structured inference response
containing:

- chunk claims with source reconciliation block IDs;
- unresolved hooks;
- review dispositions;
- the next rolling context.

Keep hierarchical scene consolidation and final-note generation initially. Use canonical structured
artifacts without duplicate intermediate Markdown:

```text
summarization/
  chunks/
    session_000.json
    ...
  scenes/
    scene_000.json
    ...
  session.json
```

Chunk claims reference reconciliation blocks. Scene claims reference chunk claims. Final session
claims reference scene claims. `session.json` contains the structured final note and provenance map;
the authored MDX is rendered from it.

Human-approved reconciliation changes preserve the original generation trail, invalidate only
dependent downstream summaries, and promote a shared correction rule only when the lesson is
reusable.

## Public Transcript Projection

Public archives derive from the readable reconciliation, not the summary-safe derivative. Summary
safety is model compatibility, not publication or privacy policy.

At archive time:

1. require a reviewed redaction manifest;
1. apply declared text and audio redactions;
1. remove physical-speaker identities;
1. render character labels with visible confidence;
1. include a confidence legend;
1. preserve overlapping utterances as separate timestamped blocks;
1. validate that physical-name labels do not survive;
1. publish atomically.

Example public labels:

- `[Andrew]` for confirmed attribution;
- `[Andrew? - probable]` for probable attribution;
- `[GM]` for narration;
- `[Player / character unknown]` when attribution is insufficient.

The private evidence linking physical speaker and channel to the candidate remains private.

## August 15 Acceptance And Benchmark Fixture

Use `astro/.bf-transcripts/session-2026-08-15` as the matched fixture.

Verified properties:

- source duration: 1:40:55;
- 11 logical chunks;
- stereo, left, and right STT passes complete;
- alignment complete;
- existing `raw_transcript.md` and `corrected_transcript.md` baselines;
- no completed summary-safe transcript or final notes;
- channel map assigns one player to the left channel and the GM to the right channel;
- left/right channels are materially independent.

Three sampled 20-second windows produced left/right correlations of approximately 0.070, 0.001, and
0.008. Relative dominance changed across the samples, making the session suitable for overlap and
physical-speaker evaluation.

Keep source audio and canonical August 15 artifacts immutable. Use separate trial roots for:

1. **Existing-pipeline baseline**
   - preserve current corrected output;
   - run the pre-change summary-safe and notes path in an isolated root;
   - record runtime/model-call evidence.
1. **Unified single-chunk candidate**
   - use one reconciliation invocation per logical chunk;
   - produce complete candidate reconciliation, summary-safe, review, summary, and note artifacts.
1. **Unified three-chunk-window candidate**
   - submit three chunks as inference context;
   - retain independent logical-chunk output ownership and the same canonical schemas;
   - do not automatically promote results.

Compare:

- current corrected transcript versus readable reconciliation;
- baseline versus candidate summary-safe text;
- baseline versus candidate final notes;
- cross-boundary dialogue continuity;
- overlapping-speech preservation;
- character-attribution precision, confidence, and abstention;
- source-event coverage and omission reasons;
- unsupported reconstruction;
- review-queue usefulness;
- summary-safe fidelity;
- runtime, model calls, token use, and retry cost.

The single-chunk implementation is the production default. Three-chunk windows remain an experiment
until the matched benchmark shows a material quality gain that justifies their larger failure unit.

## Migration And Compatibility

- Preserve all historical artifact readers.
- Stop generating the old Codex correction/context/note families only for the new unified path.
- Record the reconciliation provider, schema version, canonical paths, and final transcript path in
  the checkpoint.
- Bump the checkpoint version if required fields or completion semantics change; reject incompatible
  shapes rather than casting them.
- Keep explicit stop-after boundaries for raw assembly, reconciliation, and notes. Preserve a
  compatibility alias for the former correction-review name where practical, but present
  `reconciliation` as the new canonical stage.
- Keep reconciliation provider selection extensible; do not encode the design as an unchangeable
  Hermes-only boolean.
- Historical sessions lacking reconciliation JSON continue through existing compatibility paths.
- Benchmark roots must never be mistaken for canonical resumable session roots.

## Testing And Verification

Use TDD for the new contracts. Minimum proof:

1. strict parsing of a valid unified response;
1. rejection of malformed, duplicate, empty, extra, and out-of-window content;
1. exact source-event consumption/omission accounting;
1. preservation of genuine overlap;
1. natural fragment merging without event loss;
1. omission-ledger reasons and suspicious-compression flags;
1. summary-safe structural identity with readable blocks;
1. valid reconciliation surviving a summary-safe validation failure;
1. fallback sanitizer running only for invalid/missing safe text;
1. character attribution confidence and expected-character-only suspicion;
1. deterministic private and public rendering;
1. public removal of physical-speaker names;
1. cache-identical resume with no model call;
1. neighbor, channel-map, correction-rule, prompt, and evidence-revision invalidation;
1. one filesystem lifecycle test covering atomic writes, interruption, repair, and resume;
1. summary claims retaining reconciliation block provenance;
1. archive projection consuming structured artifacts and reviewed redactions;
1. reconciliation-disabled/historical compatibility behavior;
1. matched August 15 baseline, single-chunk, and three-chunk trial reports.

Run focused reconciliation tests first, then CLI typecheck/build/test, command-help probes, archive
tests, and `git diff --check`. The live August 15 model benchmark is acceptance evidence, not part
of the ordinary automated test suite.

## Acceptance Criteria

The design is complete when:

- new runs use at most one pre-summarization model invocation per logical chunk in the ordinary
  path;
- the readable transcript resembles natural dialogue/narration while retaining referential evidence;
- every aligned event is consumed or explicitly omitted;
- overlapping speech remains distinguishable;
- physical speaker names remain private and useful in working artifacts;
- public character guesses carry visible confidence;
- summary-safe wording cannot silently change transcript structure or omit events;
- valid `needs_review` evidence flows through summaries and post-summary correction chats;
- canonical artifacts are fewer and less duplicative than the current correction stack;
- August 15 produces comparable baseline, single-chunk, and three-chunk reports without mutating
  canonical inputs;
- the production default remains single-chunk unless benchmark evidence supports widening it.
