# Bounded Structured Summary Repair Design

## Goal

Make unified reconciliation's hierarchical note generation reliable enough for unattended canonical
runs without weakening its strict evidence, provenance, or publication contracts.

Every chunk, scene, and session summary inference receives its complete response contract. When a
response still fails parsing or validation, the runner may make exactly one bounded repair call. The
repair must return a fully valid result; otherwise the stage stops without publishing a partial
canonical artifact.

## Motivation

The August 29 production-scale run completed all 23 canonical reconciliation chunks but exposed two
summary-generation contract failures:

1. the chunk prompt required source-review dispositions without supplying the canonical
   source-review targets; and
1. after deterministic target injection was added, a later response returned an invented schema with
   aliases such as `blockIds`, `hooks`, and `sourceReviewDispositions` because the prompt named
   `summary.chunk.v1` without defining its complete shape.

Strict validation correctly rejected both responses. Repeatedly rerunning the same underspecified
inference is not a recovery policy. The tool must supply the contract it enforces and provide one
bounded opportunity to repair a malformed representation.

## Scope

This design owns:

- exact response-contract guidance for chunk, scene, and session summary prompts;
- deterministic construction of bounded validation feedback;
- one repair attempt after an invalid initial summary response;
- full post-repair schema, identity, provenance, and authoritative validation;
- private custody of original and repair diagnostics;
- cache identity and resume behavior for the new prompt and repair contract;
- production acceptance through a complete August 29 final-note run.

This design does not:

- change audio preparation, STT, alignment, or unified reconciliation;
- alter the canonical reconciliation schemas or accepted evidence;
- permit silent field-alias coercion or partial summary acceptance;
- add open-ended retries or configurable retry counts;
- let repair invent, remove, merge, or reinterpret claims, hooks, dispositions, or provenance;
- change deterministic MDX rendering or collaborative human note review;
- publish private diagnostics or transcript evidence.

## Selected Approach

Use one model-authored repair attempt with deterministic validation and publication boundaries.

Alternatives rejected:

- **Strict fail-fast only:** safe but operationally brittle for recoverable model representation
  errors.
- **Deterministic alias coercion:** hides malformed contracts, cannot safely recover omitted
  semantics, and would accumulate an unbounded compatibility vocabulary.

The selected approach keeps strict validation authoritative while bounding model recovery to one
additional call.

## Architecture

### Contract descriptors

The summary module owns one deterministic contract descriptor for each schema level:

- `summary.chunk.v1`;
- `summary.scene.v1`;
- `summary.session.v1`.

Each descriptor contains:

- the exact schema version;
- every required top-level and nested field;
- field types and required collection shapes;
- closed enum values;
- unknown-key prohibition;
- authoritative identifier domains and provenance constraints;
- one compact synthetic valid example.

The descriptor is generated from or maintained adjacent to the owning runtime schema so prompt and
parser changes are reviewed together. It must not include live transcript content, credentials,
absolute paths, or unrelated repository context.

Every initial summary prompt includes the complete descriptor for its target level. A bare
instruction to “match” a named schema is insufficient.

### Summary inference flow

For each missing chunk, scene, or session artifact:

```text
build authoritative input and exact response contract
  -> initial bounded inference
  -> preserve private initial diagnostic
  -> strict parse and validation
     -> valid: atomically publish canonical summary
     -> invalid and repair-eligible:
          -> compile bounded sanitized issues
          -> build one repair prompt
          -> one bounded repair inference
          -> preserve private repair diagnostic
          -> strict parse and all validation from scratch
             -> valid: atomically publish canonical summary
             -> invalid: stop without publication
     -> repair-ineligible: stop without repair
```

An accepted artifact is published exactly once. The invalid initial response is never used as a
partial canonical value.

## Repair Eligibility

A repair call is allowed for a nonempty, bounded response that fails:

- strict JSON parsing;
- response-schema validation;
- known authoritative-reference or provenance validation that can be expressed without retrieving
  new evidence.

A repair call is not allowed for:

- inference timeout, cancellation, empty output, or known truncation;
- source, cache, prompt, provider, profile, or schema identity failure;
- missing or mutated authoritative inputs;
- filesystem custody or atomic-publication failure;
- output exceeding the configured byte bound;
- any failure where safe feedback cannot be compiled inside its own bound.

Those failures stop at the existing durable boundary.

## Repair Prompt

The repair prompt contains only:

- the repair-contract version and target schema version;
- the complete exact response contract;
- the bounded original response;
- compact sanitized validation issues;
- authoritative IDs, source-review targets, and provenance domains already supplied to the initial
  inference;
- instructions to preserve represented meaning, use only authoritative identifiers, and emit one
  complete replacement JSON object.

It explicitly forbids:

- commentary or Markdown fences;
- aliases, extra fields, or omitted required empty collections;
- invented claims, hooks, dispositions, IDs, or evidence;
- deletion of content merely to satisfy validation;
- a second repair request.

The original response, feedback, contract, and authoritative context count toward the existing
bounded inference-input policy. Oversized repair input fails closed before model invocation.

## Validation and Publication

The repaired candidate receives no privileged path. It is validated from scratch through the same
parsers and authoritative checks as a first-pass candidate.

At minimum:

- all required fields and closed enums must validate;
- unknown keys must be rejected;
- chunk claims and hooks may reference only canonical reconciliation block IDs;
- source-review targets require exactly one durable disposition each;
- scene summaries must represent every included chunk claim and hook with complete provenance;
- the session summary must represent every included scene claim and hook with complete provenance;
- campaign, session date, prompt version, schema version, and cache identity must match caller-owned
  values;
- deterministic MDX rendering remains downstream of a fully valid session summary.

Canonical JSON and MDX writes remain atomic. A failed initial or repair response must not replace an
existing valid artifact or leave a temporary publication file.

## Diagnostics and Privacy

Initial and repair diagnostics remain under the private session tree with owner-only permissions.
Diagnostics distinguish:

- inference attempt (`initial` or `repair`);
- schema level and artifact ID;
- timeout, parse, schema, semantic, identity, or custody failure class;
- bounded sanitized validation issues;
- whether repair was attempted and whether it validated.

User-facing errors and ordinary logs report bounded structural metadata only. They must not echo raw
transcript text, full model output, correction-rule content, credentials, or absolute private paths.
Raw model output may be retained only in the existing owner-only diagnostic custody boundary.

## Identity and Resume

The prompt identity incorporates:

- schema level and schema version;
- exact contract-descriptor version;
- repair-contract version;
- provider/model/profile identity;
- authoritative input identity.

Changing the contract or repair semantics invalidates affected summary artifacts. Valid artifacts
with matching identity are reused without inference. Resume begins at the first missing or stale
artifact and preserves earlier valid artifacts.

The repair result does not create a parallel canonical schema. Its canonical artifact has the same
summary schema as a valid initial response and records repair provenance only in private diagnostics
or bounded runner metadata, not in reader-facing note content.

## Failure and Retry Policy

Each artifact receives at most:

- one initial inference; and
- one repair inference if eligible.

No loop, process restart, or outer resume may silently grant additional repair attempts for the same
failed candidate under the same run identity. A later operator-invoked resume may make a new initial
attempt from the durable missing-artifact boundary; its own invalid response again has at most one
repair attempt.

If repair fails, the stage remains pending, downstream summaries and MDX are not generated, and the
CLI exits nonzero with a bounded actionable error.

## Testing Strategy

Use focused RED-to-GREEN tests at the summary runner boundary. One representative test may prove
several tightly coupled facets when its assertions remain explicit.

Required coverage:

1. chunk, scene, and session prompts include their exact contract descriptors;
1. a valid initial response makes one inference call and publishes once;
1. invalid initial plus valid repair makes exactly two calls and publishes once;
1. invalid initial plus invalid repair makes exactly two calls and publishes nothing;
1. timeout, empty, oversized, identity, and custody failures do not invoke repair;
1. semantic invention, omission, or unsupported provenance remains rejected after repair;
1. diagnostics identify both attempts while ordinary errors remain bounded and content-safe;
1. matching valid artifacts resume with zero calls;
1. a contract or repair-version change invalidates the affected cache identity;
1. interrupted atomic publication preserves prior bytes and removes invocation-owned temporary
   files.

Verification for final implementation bytes:

- focused reconciliation-summary tests;
- full CLI test suite;
- CLI typecheck and build;
- repository lint and formatting checks;
- `git diff --check`;
- focused exact-commit review of the new repair boundary.

## Production Acceptance

The implementation is not considered production-ready from unit tests alone. Resume the private
August 29 session from its validated reconciliation artifacts and require:

- 23 valid chunk summaries;
- 5 valid scene summaries;
- 1 valid session summary;
- a nonempty deterministic `2026-08-29.mdx` note;
- `notes_summary_pass.status` equal to `complete`;
- `done.status` equal to `complete`;
- successful process exit with no orphaned inference or transcription processes;
- site lint and build passing with the generated note present.

The source FLAC and canonical reconciliation inputs remain immutable. Private run receipts identify
the exact code commit and source fingerprint. No canonical note run on `main` is approved until this
acceptance succeeds on the feature branch and the reviewed commits are merged deliberately.

## Stop Conditions

Stop and report a blocker rather than weakening validation when:

- a repair needs new evidence or semantic judgment;
- the complete repair prompt cannot fit within established bounds;
- the same artifact remains invalid after its one repair attempt;
- source or cache identity changes unexpectedly;
- atomic publication or private diagnostic custody cannot be guaranteed;
- production acceptance produces a note that fails schema, checkpoint, site lint, or site build
  validation.
