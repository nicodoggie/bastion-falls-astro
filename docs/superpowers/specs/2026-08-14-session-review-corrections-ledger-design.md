# Session Review Corrections Ledger Design

**Date:** 2026-08-14

## Purpose

Preserve accepted, session-specific human corrections without implying that every recovered
utterance is a reusable transcription rule. The first ledger records the 2026-08-08 correction from
“with that space” to “with that Stacy.”

## Scope

Create one private, session-local artifact:

`astro/.bf-transcripts/session-2026-08-08/review-corrections.yaml`

The initial change also updates the `bastion-note-cleanup-workflows` skill so future accepted human
corrections are recorded consistently. It does not add a parser, formal schema, CLI behavior,
archive integration, publication classification, or shared correction rule. The ledger’s eventual
archive treatment will be decided after the session-note correction pass.

## YAML Shape

The document contains:

- `version`
- `sessionDate`
- `campaign`
- `corrections`, an append-only sequence of accepted review decisions

Each correction contains:

- a stable session-local `id`;
- transcript `start` and `end` timestamps;
- the damaged `heard` wording;
- the accepted `corrected` wording;
- a short `interpretation` describing its effect on the campaign note;
- relative `evidence` paths to the reconciled and available lane transcripts;
- the authored `notePath` and `noteSection` affected;
- `reviewedAt`;
- a `provenance` category, initially `campaign-maintainer-recollection`.

No personal reviewer name is required. Relative paths keep the ledger portable with its session
directory and repository checkout.

## Review Workflow

Update `bastion-note-cleanup-workflows` with this sequence:

1. Establish the exact transcript evidence and accept the human correction.
1. Classify the utterance as one-off or reusable before considering shared rules.
1. Patch the authored note and preserve generated transcript artifacts as provenance.
1. Create or append the accepted decision to the session’s `review-corrections.yaml` ledger.
1. Only for reusable drift, separately add or update a narrow shared rule in `corrections.yaml`.

The ledger records accepted corrections in both classes. Classification controls shared-rule
promotion, not whether the human review decision is preserved. The skill should not require a
ledger entry for tentative suggestions, unresolved audio checks, or corrections that were not
accepted.

## First Entry

Record the 00:21:31–00:21:55 exchange where the reconciled transcript retained “with that space.”
Human campaign review settled the spoken phrase as “with that Stacy,” meaning that the court wizards
had last gone to the guest room assigned to Stacy.

Evidence points to:

- `reconciled_transcription/session_002.md`
- `raw_transcription/passes/left/session_002.md`
- `raw_transcription/passes/right/session_002.md`
- the `Searching the Guest Quarters` section of the authored 2026-08-08 note

## Validation

For this first data-only artifact:

- parse the YAML with the repository’s existing YAML library;
- read back the stored fields and evidence paths;
- verify referenced evidence files exist;
- verify the note-cleanup skill describes ledger updates separately from shared-rule promotion;
- run `git diff --check` for the authored note and design file.

A formal runtime schema and archive acceptance checks are deferred until the ledger’s eventual
consumer and privacy boundary are chosen.
