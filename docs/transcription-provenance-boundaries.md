# Transcription provenance boundaries

## Ownership rule

Models choose wording, evidence references, attribution, uncertainty, and review
judgments. Code supplies values determined entirely by the invocation or selected
references. A model copying a hash does not authenticate its response.

Apply caller binding only to a live response associated with its exact invocation.
Never use it to make a persisted artifact match a new job. Offline diagnostic
salvage requires establishing the original invocation and evidence independently.

## Audited boundaries

| Boundary | Code-owned fields and behavior | Model-owned decisions |
| --- | --- | --- |
| Unified reconciliation | Schema/prompt versions, chunk window, complete cache identity; block bounds, omission source text/bounds, correction source form derived before parsing | Block IDs, wording, source-event selection, grouping, omission reasons, corrections and evidence, attribution and review flags |
| Chunk summaries, initial/repair/refusal retry | Schema version, cache identity, chunk ID, source review targets/notes/flags, reference-derived original review flags; maps invocation-local `review_target_NNN` aliases to durable IDs before strict validation | Claims/hooks, selected block references, review dispositions, rolling context |
| Scene summaries, initial/repair/refusal retry | Schema version, cache identity, scene ID, ordered chunk IDs and chunk-claim provenance | Claims/hooks and their selected source references (scene/chunk IDs are deterministic local IDs, not hash references) |
| Session summaries, initial/repair/refusal retry | Schema/prompt versions, cache identity, complete provenance closure; campaign/date when supplied by caller | Narrative sections, claims/hooks and references, confirmations, boundaries (session/scene IDs remain deterministic local IDs) |
| Refusal cleanup | Preserve source metadata, records, order and provenance; apply edits only to allowlisted prose paths | Non-graphic prose replacements and which prose paths need changes |
| Legacy Codex/Ollama final notes | Generate frontmatter from caller campaign/date, replacing any generated frontmatter | MDX body |
| Evidence assembly and STT | Source/alignment/context hashes, stable event IDs, pass/checkpoint identity | ASR wording/timing from the engine; reconciliation decisions remain separate |

The structured summary API retains compatibility with callers that omit campaign
or date: there is no authoritative value to inject in that case. Production CLI
integration supplies both. Do not fabricate a default date or infer one from the
processing clock.

## Checks intentionally retained

- Resume authenticates stored reconciliation identity and canonical status before
  reuse. Missing, stale, malformed or inconsistent artifacts are not rebound.
- Summary caches retain strict schemas and provenance validation. Scene reuse
  additionally requires the expected scene ID and exact ordered chunk set;
  session reuse requires the expected prompt version and supplied campaign/date.
- Unknown or unsupported model-selected references, unsupported semantic enums,
  unknown fields, missing evidence accounting, empty blocks and gross compression
  remain failures. Code cannot choose substitute evidence just to pass validation.
- Existing duplicate-owner normalization and relocation of recognized misplaced
  suspicion flags are unchanged. This repair does not redesign those previously
  established policies; it removes deterministic echo obligations.
- Cleanup caches must contain complete validated derivatives, not edit envelopes.
  Legacy full-response cleanup is accepted only through exact structural checks.
- The isolated lossless-format-repair benchmark keeps its protected-original
  projection/lexical and identity checks. It tests preservation of an externally
  supplied original, not a live reconciliation invocation; rebinding it would
  invalidate the benchmark's losslessness claim.
- Legacy free-form transcript correction/review retains timestamp preservation
  instructions. Mapping changed free-form lines back to speech is not a hash or
  metadata confirmation; assigning timestamps by position could misattribute text.
- Archive validation remains a publication/content boundary, not proof that an
  artifact was generated under today's prompts or configuration. No new archive
  identity migration or publication is part of this repair.

## Prompt and cache compatibility

Canonical artifact schemas are unchanged. Live reconciliation accepts legacy
identity/source echoes but overwrites code-owned fields before schema validation;
new prompts tell the model to omit them. Existing cache-valid reconciliation
chunks remain reusable because evidence identity is unchanged by these
bookkeeping-only prompt instructions.

Summary prompts include their exact bytes in cache identity. Removing caller-owned
output fields from summary contracts intentionally invalidates old summary caches.
Introducing invocation-local source-review aliases also changes prompt bytes and
therefore invalidates old summary caches; it does not invalidate audio or accepted
reconciliation artifacts. Durable IDs remain in persisted artifacts and strict
validation still rejects unknown aliases or IDs. Refusal cleanup prompts redact
64-hex hash tokens into local placeholders because cleanup edits are path-based and
do not need durable provenance identifiers. This does not require rerunning audio
transcription or accepted reconciliation.
The September 20 failed run had not reached summaries.

## Verification scope

Focused tests exercise omitted/malformed live metadata, source hydration, strict
resume, code-owned frontmatter and edits-only cleanup through the real summary
runner. Unknown references, semantic rejection, refusal recovery, subprocess
cleanup, and atomic persistence retain their existing tests. These are local
contract tests, not a live model-quality or full-session completion claim.
