# Hermes Transcript Reconciliation Design

## Goal

Add an optional Hermes-powered reconciliation stage to the Vengeful transcription workflow so
canon-aware mistakes are corrected before hierarchical note generation. Keep the existing Codex
pass for literal timestamp-preserving ASR cleanup; use Hermes for evidence retrieval, cross-session
canon reconciliation, and uncertainty classification.

The workflow should reduce mechanical correction work without removing Nico and Ran's shared review
sessions. Human review should shift toward campaign meaning, character interpretation, and genuinely
uncertain details.

## Pipeline

1. Speech-to-text produces raw timestamped transcript chunks.
1. The existing Codex correction pass produces literal corrected chunks and per-chunk correction
   notes using the glossary, shared correction rules, and rolling context.
1. When Hermes reconciliation is enabled, each chunk receives a second review:
   - the raw chunk;
   - the Codex-corrected chunk;
   - the corresponding Codex correction-note chunk;
   - campaign name and session date;
   - repository access through the Hermes file/search tools;
   - preloaded Bastion note-review and transcript-evidence skills.
1. Hermes returns:
   - a timestamp-preserving reconciled transcript chunk;
   - concise evidence-oriented review notes containing only unresolved or materially important
     adjudication items.
1. Reconciled chunks and review notes are joined into separate session-level artifacts.
1. Existing summary cleanup and hierarchical note generation consume the reconciled transcript and
   Hermes review notes when present. With reconciliation disabled, the current Codex-only flow is
   unchanged.
1. Human review remains the final canon-setting step.

## Scope and Activation

The first implementation is opt-in at the CLI level and configurable per project. Repositories that
do not configure review retain the current Codex-only behavior. Bastion Falls can enable Hermes
review for upcoming games in `astro/.bfcli.yml` while still allowing individual runs to disable it.

Add run-command flags:

- `--review <provider>`: override the configured review provider for one run. The first supported
  provider is `hermes`; `off` is the explicit disabled value.
- `--hermes-profile <name>`: override the Hermes profile used for reconciliation for one run.
- `--hermes-max-turns <number>`: cap tool iterations per chunk; default `12`.

Add project configuration under `transcribe`:

```yaml
transcribe:
  review:
    provider: hermes # or off
    hermes:
      profile: default
```

Resolve the effective review provider in this order:

1. `--review` command-line override;
1. `transcribe.review.provider` from the nearest `.bfcli.yml`;
1. `off` when neither is set.

Resolve the Hermes profile in this order:

1. `--hermes-profile` command-line override;
1. `transcribe.review.hermes.profile` from the nearest `.bfcli.yml`;
1. the currently active/default Hermes profile when neither is set.

Reject unsupported provider names with an actionable error. As part of enabling the new flow for
Bastion Falls, set `transcribe.review.provider: hermes` and configure its profile under
`transcribe.review.hermes.profile` in `astro/.bfcli.yml`. A run can use `--review off` to recover
the previous behavior without editing project configuration.

Do not add model/provider flags initially. Model, provider, memory, and tool configuration remain
the responsibility of the selected Hermes profile. This keeps project CLI configuration separate
from Hermes runtime configuration.

A later change may make Hermes review the unconfigured CLI default after the July 12 replay
demonstrates acceptable accuracy, cost, and runtime. That decision is separate from enabling it in
the Bastion Falls project configuration now.

## Hermes Invocation

Invoke Hermes non-interactively for each chunk:

- quiet output;
- source tag `tool`, keeping automation runs out of ordinary session browsing;
- selected profile when supplied;
- `file` toolset only;
- preload `bastion-note-review-corrections` and `bastion-transcript-evidence-workflows`;
- enforce the configured maximum turns;
- use the repository root as the working directory.

Each chunk uses a fresh Hermes session. A single session for an entire recording would accumulate
the full raw and corrected transcript, eventually forcing compression and making later chunks less
reliable. Fresh source-tagged sessions keep chunk review bounded while shared correction rules and
repository evidence provide durable continuity.

The review prompt must explicitly prohibit repository edits. Hermes may read and search source
files, but its final response is the only accepted output. The initial implementation relies on this
read-only instruction because Hermes currently exposes read and write operations together through
the `file` toolset. The workflow must never pass `--yolo` or terminal tools.

## Output Contract

Hermes returns exactly two tagged sections:

```text
<reconciled-transcript>
...timestamp-preserving Markdown...
</reconciled-transcript>
<review-notes>
...concise Markdown...
</review-notes>
```

The parser must:

- require exactly one non-empty `reconciled-transcript` section;
- require exactly one `review-notes` section, which may contain `None.`;
- reject text outside the two sections except surrounding whitespace;
- fail with the chunk name and preserved raw Hermes output when the contract is invalid.

Do not silently fall back to the Codex chunk after a failed enabled review. Silent fallback would
make an apparently reconciled run contain mixed review quality. The existing resumable artifact flow
makes an explicit failure recoverable.

## Artifacts

Keep Codex outputs unchanged for comparison and provenance. Write Hermes outputs under the session
output directory:

- `reconciled_transcription/session_N.md`
- `hermes_review_notes/session_N.md`
- `reconciled_transcript.md`
- `hermes_review_notes.md`

Downstream note generation uses these paths only when `--hermes-review` is enabled. This preserves a
clean A/B comparison between raw transcript, Codex correction, and Hermes reconciliation.

The checkpoint's correction stage should record whether Hermes review was enabled and the final
transcript/review-note paths used downstream. Existing checkpoints remain readable.

## Archive Integration

Revise `bfcli transcribe archive` so successful reconciliation artifacts survive cleanup of the
working session directory. Preserve the archive command's existing top-level-artifact convention;
do not recursively archive per-chunk working directories in this change.

Add these optional top-level files to the archive plan:

- `correction_notes.md`, which the current archive plan omits;
- `reconciled_transcript.md`;
- `hermes_review_notes.md`.

Continue archiving `raw_transcript.md`, `corrected_transcript.md`, and the shared
`corrections.yaml`. `raw_transcript.md` remains required; every later-stage artifact remains
optional so Codex-only, skipped-correction, interrupted, and historical sessions can still be
archived.

The archived files preserve a useful provenance ladder:

1. `raw_transcript.md`: speech-to-text output;
1. `corrected_transcript.md`: literal Codex correction;
1. `correction_notes.md`: Codex uncertainty record;
1. `reconciled_transcript.md`: Hermes canon-aware correction;
1. `hermes_review_notes.md`: remaining evidence-oriented questions.

Do not replace `corrected_transcript.md` with the reconciled transcript under the old filename. Both
artifacts are needed for A/B evaluation and future audit.

## Reconciliation Rules

The Hermes prompt must distinguish three classes of change:

1. **High-confidence canon correction**
   - Supported by canonical articles, older authored notes, or confirmed shared correction rules.
   - Apply directly to the reconciled transcript while preserving timestamps, language, and line
     order.
1. **Likely ASR correction without durable canon evidence**
   - Apply only when the raw and corrected forms strongly support it.
   - Record the decision briefly in review notes when it could affect later canon.
1. **Genuine ambiguity or new canon**
   - Preserve the uncertain wording rather than normalizing it to familiar lore.
   - Add a timestamped review note with evidence paths and the exact remaining question.

Hermes must not summarize, remove ordinary table speech, convert in-game mysteries into
transcription confirmations, or apply later-session knowledge as though it were known during the
recorded session. It may use later confirmed correction rules to repair names while keeping
chronology explicit.

The current session's authored note and generated summaries are downstream outputs, not evidence.
Exclude them from both production and historical review, even when a replay runs in a working tree
where those files already exist. Authored-note evidence must predate the supplied session date.

## July 12 Replay

Use a separate experimental output directory and do not overwrite the existing 2026-07-12 session
artifacts or authored note.

Run two comparisons:

1. **Historical replay:** run the reviewer from a temporary detached worktree whose evidence root
   predates the manual July 12 review, and supply a correction-rule snapshot from that point. Read
   the raw July 12 chunks through explicit absolute paths outside the worktree. The authored July 12
   note must not exist in the evidence root. If an exact pre-review correction snapshot is
   unavailable, record the closest available commit and treat the result as an approximate replay
   rather than silently claiming a clean historical evaluation.
1. **Production replay:** use the current correction store. This measures the output quality
   available for future normal operation.

Compare at minimum:

- known canonical corrections caught;
- unsupported corrections introduced;
- genuine uncertainty preserved;
- synthetic confirmations avoided;
- manual interventions remaining;
- elapsed runtime and model usage.

Known benchmark cases include Illegally Bear versus Legally Bare, Luana/Cinna Moan identity, Marcus
Parnassus, the Maiden's Field submarine route, and Oren Bell's chosen present-day identity.

## Error Handling and Resume

- Missing Hermes executable: fail before starting reconciliation with an actionable message.
- Non-zero Hermes exit: report the chunk and command failure without deleting completed artifacts.
- Invalid tagged response: preserve the response in a diagnostic file beside the chunk and fail.
- Existing reconciled chunk plus resume: reuse it unless `--force` is set.
- Empty source chunk: preserve the existing chunk behavior and avoid invoking Hermes unnecessarily.
- Interrupted runs: restart from the first missing reconciled chunk.

## Testing

Follow TDD with focused unit tests before implementation:

- build the Hermes review prompt with raw, Codex, note, campaign, date, and path context;
- build the expected Hermes CLI arguments with and without a profile;
- parse a valid tagged response;
- reject missing, duplicate, empty, or extra tagged content;
- join reconciled transcript and review-note chunks in natural chunk order;
- reuse completed chunks in resume mode and regenerate with force;
- resolve review-provider precedence as CLI flag, project configuration, then `off`;
- resolve Hermes-profile precedence as CLI flag, project configuration, then active/default profile;
- reject unsupported review providers;
- route downstream note generation to reconciled artifacts only when enabled;
- preserve existing Codex-only behavior when disabled;
- record compatible checkpoint metadata.
- include correction notes and optional Hermes reconciliation artifacts in compressed and unpacked
  archives;
- preserve archive compatibility when Hermes artifacts are absent.

Use a fake Hermes executable or injected command runner for automated tests. Do not invoke a
paid/live model from the unit suite.

Validate implementation with:

- focused transcribe tests;
- CLI build/typecheck;
- command help showing the new flags;
- a small fake-Hermes smoke run;
- the isolated July 12 production replay, followed by artifact comparison rather than automatic
  promotion.
