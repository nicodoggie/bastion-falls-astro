# Lossless Reconciliation Format Repair Design

## Goal

Add one bounded, formatting-only repair attempt for complete reconciliation outputs that fail JSON
or strict response-shape validation. The repairer may recover representation but may not revisit
transcript meaning, evidence ownership, omission decisions, correction replacements, attribution, or
summary-safe content.

The first implementation phase builds and evaluates the repair core independently. Production
reconciliation is wired to it only after a matched fixture bake-off proves semantic preservation and
safe rejection of unrepairable cases.

## Motivation

Unified reconciliation intentionally consolidates readable transcript reconstruction, summary-safe
text, attribution, omissions, material corrections, and review metadata into one evidence-aware
inference. Strict validation has exposed several output-shape failures that older prose pipelines
would silently preserve, smooth over, or obscure:

- a valid suspicion enum placed in a block review-field enum;
- schema-required empty collections omitted;
- model annotations exceeding their bounded string contract;
- otherwise-valid JSON preceded by Hermes transport framing;
- redundant source echoes such as timestamps or source forms disagreeing with caller-owned evidence;
- duplicate source-event accounting between neighboring blocks.

Transport framing and provable source echoes belong to deterministic code and are already normalized
there. Some remaining failures are representation errors that a lossless formatter can repair
without performing another reconciliation. Retrying full evidence inference for those errors is
expensive and can introduce new semantic drift.

## Scope

This design owns:

- deterministic normalization of parser and Zod issues into a bounded repair payload;
- a closed classification of formatting-repairable and unrepairable failures;
- protected semantic projections and digests;
- a standalone Codex one-response control and an isolated Hermes session with exactly one available
  pure validator tool;
- strict repair-envelope parsing;
- post-repair semantic-equality, schema, identity, and authoritative validation;
- original/repaired diagnostic custody and repair metrics;
- a synthetic committed fixture corpus and private live fixture bake-off;
- matched Terra and Sol evaluation across both adapters;
- optional production integration only after the fixture gate passes.

This design does not:

- add a second reconciliation or evidence-review pass;
- allow either formatter lane to read transcripts, repository context, correction rules, or private
  host files; the Hermes lane may access no network, filesystem, shell, or tool other than the
  candidate validator, while the Codex lane is blocked unless its sandbox demonstrably prevents
  model tools from escaping the empty invocation workspace;
- retry empty, truncated, timed-out, identity-mismatched, or evidence-invalid output as formatting;
- make repair attempts configurable;
- relax source-event accounting, canonical status derivation, cache identity, or filesystem custody;
- replace collaborative human review;
- redesign the model response into a new reconciliation schema version.

## Architecture

### Phase A: repair core and accuracy harness

Phase A adds a standalone repair module and fixture runner. It does not alter production runner
behavior.

The module has five responsibilities:

1. classify a failure;
1. normalize it into `RepairIssue[]`;
1. build a protected semantic projection and digest when possible;
1. parse and verify a repair result;
1. report repairability, semantic equality, and target validation outcomes.

A model bake-off runs against the fixture runner. No formatter becomes a production dependency in
Phase A.

### Phase B: one-attempt runner integration

Phase B is permitted only after a selected formatter passes the Phase A gate. The reconciliation
runner invokes it once after deterministic normalization and only for eligible parse/schema
failures. The ordinary successful path remains one reconciliation inference.

```text
raw reconciliation output
  -> preserve original diagnostic
  -> deterministic transport cleanup
  -> strict JSON parse and response-schema validation
     -> success: deterministic canonical compilation
     -> eligible formatting failure:
          -> build bounded repair payload
          -> one selected repair session
             -> standalone Codex: one schema-constrained final response
             -> Hermes: capture the authoritative validator-tool argument
          -> protected semantic equality
          -> target schema and identity validation
          -> deterministic canonical compilation
          -> authoritative validation from scratch
             -> success: canonical needs_review + repair provenance
             -> failure: stop
     -> ineligible failure: stop
```

## Failure Classification

The classifier returns one of:

- `repairable-format`
- `unrepairable-semantic`
- `unrepairable-incomplete`
- `unrepairable-identity`
- `unrepairable-security`

Classification is deterministic. The formatter cannot promote an ineligible failure into a
repairable one.

### Initially eligible issue codes

The initial closed issue enum is:

- `invalid-json`
- `invalid-enum-location`
- `unrecognized-key`
- `missing-empty-collection`
- `optional-field-presence`
- `invalid-escaping`
- `nonsemantic-framing`

New issue codes require a real failing fixture and an explicit protected-content rule.

### Ineligible failures

The formatter is not called for:

- timeout, empty output, or known truncation;
- source receipt or lane-root security failure;
- chunk, cache, provider, model, profile, prompt, or schema identity mismatch;
- invented or unknown source-event IDs;
- missing authoritative event accounting;
- unsupported attribution or correction claims;
- meaning-changing summary-safe output;
- failures requiring a new event grouping, omission reason, correction replacement, or attribution
  decision.

Those failures use ordinary failed-chunk recovery or a genuine reconciliation retry, not format
repair.

## Repair Payload

The repair input is a strict, bounded object:

```json
{
  "repairVersion": 1,
  "targetSchemaVersion": "reconciliation.v1",
  "originalOutput": "<raw output>",
  "classification": "repairable-format",
  "issues": [
    {
      "stage": "schema",
      "code": "invalid-enum-location",
      "path": ["blocks", 17, "reviewFlags", 1],
      "actualValue": "unsupported-proper-noun",
      "allowedValues": ["ambiguous-speaker", "unclear-words"],
      "sameValueAllowedAt": [["suspicionFlags"]]
    }
  ],
  "protection": {
    "kind": "projection",
    "value": {},
    "digest": "<sha256>"
  }
}
```

Bounds cover:

- original-output bytes;
- issue count;
- path depth and path segment length;
- enum and key lists;
- error strings;
- projection depth and collection size.

Raw stack traces, credentials, unrelated stderr, absolute paths, and repository content are
excluded.

## Normalized Repair Issues

Raw parser and Zod errors are developer-oriented and are not passed directly. The classifier
compiles compact issues such as:

```json
{
  "stage": "schema",
  "code": "invalid-enum-location",
  "path": ["blocks", 17, "reviewFlags", 1],
  "actualValue": "unsupported-proper-noun",
  "allowedValues": [
    "ambiguous-speaker",
    "unclear-words",
    "possible-omission",
    "attribution-uncertain",
    "material-correction"
  ],
  "sameValueAllowedAt": [["suspicionFlags"]]
}
```

For a parseable object, the classifier may inspect the value at the failing path. It may not
retrieve new evidence or reinterpret content.

## Repair Result

The formatter returns one strict envelope:

```json
{
  "repairable": true,
  "repairedOutput": {}
}
```

or:

```json
{
  "repairable": false,
  "reason": "semantic-change-required"
}
```

`reason` is a closed enum. Freeform explanation is forbidden.

The formatter receives a fixed instruction:

> Perform lossless structured-output repair. Address only the supplied issues under the supplied
> schema. Do not add, remove, paraphrase, summarize, reinterpret, correct, or reorder semantic
> content. If the schema cannot be satisfied without semantic change, return the fixed unrepairable
> envelope. Return no Markdown or commentary.

The instruction includes both complete envelope examples above rather than requiring the model to
infer a private shape from the phrase "repair envelope."

### Standalone Codex submission

The standalone Codex control receives the same semantic repair packet plus the exact final-response
JSON Schema. It emits one response and receives no host-validation feedback. The host then parses
and validates that candidate deterministically. Any malformed, semantically changed, or unrepairable
candidate fails the fixture without a second response.

### Hermes validator-tool submission

The Hermes validator candidate has exactly one available tool, `validate_repair_json`. Its sole
argument is a `RepairEnvelope`. The tool is implemented by a pure local script and receives only the
candidate, the frozen repair payload, and the deterministic validation authority already owned by
the harness. It has no filesystem, network, shell, repository, transcript, memory, credential, or
generic tool access.

The tool validates the exact envelope union, target reconciliation schema, immutable identity,
protected semantic equality, source-event accounting, and permitted structural repair. On failure it
returns only bounded machine-readable issue codes and paths. The model may correct the candidate and
call the same tool once more. Therefore one repair session permits at most two validator calls: the
initial submission and one correction.

The last valid tool argument is the authoritative repair result. Free-text assistant output is not
copied or reparsed as the candidate, preventing the model from validating one value and emitting a
different one afterward. A session with no valid tool submission fails.

## Protected Semantic Projection

For parseable original output, deterministic code builds a projection containing:

- exact chunk and cache identity;
- block order and IDs;
- block source-event IDs;
- readable and summary-safe text;
- block kind;
- channel and physical-speaker values;
- character candidate and confidence;
- attribution-basis strings;
- omission source-event IDs and reasons;
- correction source-event IDs, replacements, and evidence;
- review-note content;
- summary-safety content.

Formatting equivalence rules are explicit:

- object key order and insignificant whitespace do not matter;
- a missing optional collection and an empty collection compare equal only where the target schema
  defines that equivalence;
- the multiset of review/suspicion enum values is protected while legal location may change;
- deterministic source echoes are excluded because the runner owns them.

The repaired projection must hash identically to the original projection after applying only these
normalizations.

## Invalid JSON and Lexical Preservation

Invalid JSON is eligible only when a bounded lexical inventory can prove content preservation. The
inventory extracts recoverable JSON content tokens:

- strings;
- finite numbers;
- booleans;
- nulls.

After repair, the exact ordered content-token inventory must match. Punctuation, separators, braces,
escaping, and formatting may change, but malformed-JSON repair may not relocate keys or values.
Enum/key relocation is available only for parseable originals protected by the semantic projection,
not for lexical invalid-JSON repair. If the original is truncated, has an unterminated content
token, or cannot be inventoried confidently, classification is `unrepairable-incomplete` and no
formatter is called.

## Formatter Runtime

Both formatter runtimes have:

- no repository context;
- no profile memory or companion identity context;
- no external retrieval;
- one repair session maximum;
- a strict timeout and output-byte cap;
- an explicit model/provider identity recorded in diagnostics;
- no fallback chain that silently changes the formatter model.

Their tool contracts are lane-specific:

- standalone Codex emits one schema-constrained final response with zero validator calls and is
  blocked unless the synthetic adversarial preflight proves that model-exposed capabilities cannot
  escape its empty invocation workspace;
- Hermes exposes exactly one pure `validate_repair_json` tool, permits one or two validator calls,
  and exposes no generic filesystem, shell, network, repository, profile, memory, skill, plugin, or
  MCP capability.

Each live launcher must prove its adapter-specific constraints through the strict receipt union:
ignored rules/user configuration, an empty owner-only cwd outside repository and fixture roots, a
complete inline semantic packet with no file reference, an allowlisted environment, and the exact
zero-validator or singleton-validator contract. If that proof is unavailable, only that lane is
blocked rather than weakened; another independently proven lane may continue.

The formatter does not receive authoritative transcript evidence. It cannot perform reconciliation.

## Post-Repair Validation

A repair is accepted only when all checks pass in order:

1. strict `RepairEnvelope` parsing;
1. `repairable: true`;
1. strict target response-schema parsing;
1. exact chunk/cache identity echo;
1. protected projection or lexical inventory equality;
1. deterministic source-echo compilation;
1. authoritative event validation from scratch;
1. isolated Phase A candidate reread after atomic publication.

A formatter claim never bypasses a deterministic check. Phase A publishes and rereads candidate
artifacts only beneath its ignored scratch root; it does not publish production canonical artifacts.

## Canonical Status and Provenance

A repaired result is always at least `needs_review`, even when ordinary content-derived status would
be `valid`.

Diagnostics retain:

- original raw output;
- normalized repair issues;
- formatter model/provider identity;
- formatter prompt version;
- repaired raw output;
- protected before/after digests;
- final validation outcome;
- timing, calls, retries, and token metrics when supplied.

Original diagnostics remain immutable. Repaired output receives a separate diagnostic artifact. The
Phase A harness always publishes a strict sanitized `phase-a-report.json` and matching Markdown
report with status `passed`, `failed`, or `blocked`, including a fixed blocker reason when live
model or context/tool isolation cannot be proven.

## Calls, Retries, and Stop Rules

The top-level repair-session count is fixed at one and is not configurable in this version.
Adapter-level accounting is lane-specific:

- standalone Codex emits one schema-constrained response, makes one provider API call, and makes
  zero validator calls;
- Hermes uses one session, makes one or two provider API calls, and calls the singleton validator
  one or two times: initial submission plus at most one bounded correction.

Provider API calls and validator calls are recorded separately and truthfully. Evaluator-level
`calls` and `retries` retain the existing aggregate contract and count the original reconciliation
plus the single repair session, not internal provider turns:

- ordinary success: `calls = 1`, `retries = 0`;
- repaired success: `calls = 2`, `retries = 1`;
- repair unavailable, unrepairable, invalid, or digest-mismatched: fail the current chunk;
- never invoke a second formatter session, a second standalone Codex response, or a third Hermes
  validator call;
- never silently fall through to a full reconciliation retry.

Production chunk resume remains separate: validated earlier canonical chunks are reused when their
cache identities match, and only the failed chunk is retried.

## Fixture Corpus

### Committed synthetic fixtures

Committed fixtures contain no private campaign text or identities.

Expected repair:

- enum value in the wrong schema field;
- unknown nonsemantic key;
- missing required empty collection;
- Markdown fence or known framing;
- missing comma;
- recoverable escaping error;
- invalid optional-field representation.

Expected unrepairable:

- invented source-event ID;
- missing event accounting;
- changed readable or summary-safe text;
- changed correction replacement;
- changed attribution;
- truncated object;
- empty output;
- cache identity mismatch;
- overlong semantic text requiring rewriting.

The changed readable text, changed summary-safe text, changed correction, and changed attribution
cases are validator-only adversarial candidates. Their malformed `originalOutput` is intentionally
identical to a repairable structural fixture, so sending them as separate model prompts would either
leak the expected outcome or score identical prompts against contradictory answers. The model
bake-off excludes those four IDs. Their safety gate is owned by the deterministic validator tests;
the remaining positive and distinguishable negative fixtures form the non-oracular model corpus.

### Private live fixtures

Private diagnostics stay under isolated ignored trial roots. They include the observed wrong-enum,
Hermes framing, and other bounded failures. They are never committed.

## Formatter Model Bake-Off

The same non-oracular model corpus is run through two matched adapters:

1. **Standalone Codex control.** Invoke the existing `codex exec` CLI using its ordinary `~/.codex`
   OAuth custody, an explicit model, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`,
   `--sandbox read-only`, and an owner-only repair-envelope JSON Schema. Run from a newly created
   empty owner-only temporary Git repository with no additional directories. The model gets one
   schema-constrained response and deterministic host validation afterward; it gets no semantic
   correction feedback.
1. **Hermes validator candidate.** Run with no profile context and exactly one available pure
   validator tool. Permit one repair session with an initial submission and at most one correction
   after bounded deterministic feedback. The last valid tool argument is authoritative.

Model-facing payloads contain only the original output, deterministic classification, and normalized
issue codes—never fixture IDs, expectations, expected repaired output, or expected refusal reasons.
Both adapters receive the same **semantic repair packet**: original output, normalized issues,
corpus, order, requested model identity, and host-validation bounds. Adapter-specific transport
bytes necessarily differ: Codex receives a final-response JSON Schema, while Hermes receives a
singleton tool schema and may receive bounded validation feedback. Hash the shared semantic packet
and each adapter envelope separately. Their isolation and actual model/provider identity must be
proven independently from durable receipts.

The Codex isolation preflight uses only synthetic decoys. Before any private fixture call, create
owner-only random-marker files in three locations: a readable workspace control, a sibling
directory, and a separate owner-only temporary directory representing a credential-like path. Invoke
an explicit adversarial canary that attempts to read each exact decoy through every model-exposed
filesystem or shell capability and attempts a network request to a harness-owned loopback listener.
Never point the canary at `~/.codex`, real credentials, repository files, or private diagnostics.
Parse the complete bounded Codex JSONL event stream and independently inspect the marker/listener
results. The workspace marker must be returned to prove the canary exercised the tool; sibling and
external markers must not be returned, and the loopback listener must receive no connection. If
Codex's read-only sandbox permits arbitrary host reads, hides tool events, or cannot prove these
properties, the control is `blocked-no-context-isolation`; do not run private fixtures through it.

Every lane invocation emits an owner-only strict internal receipt. The sanitized Phase A report does
not embed these receipts or raw events; it records only their digest and bounded status/metrics:

```ts
type AdapterReceipt =
  | {
      status: "completed";
      adapter: "standalone-codex";
      provider: string;
      model: string;
      apiCalls: 1;
      validatorCalls: 0;
      schemaDigest: string;
      semanticPacketDigest: string;
      adapterEnvelopeDigest: string;
      ephemeral: true;
      ignoredUserConfig: true;
      ignoredRules: true;
      emptyWorkspace: true;
      noAdditionalDirectories: true;
      adversarialIsolationPassed: true;
    }
  | {
      status: "completed";
      adapter: "hermes-validator";
      provider: string;
      model: string;
      apiCalls: 1 | 2;
      validatorCalls: 1 | 2;
      semanticPacketDigest: string;
      adapterEnvelopeDigest: string;
      singletonValidator: true;
      ignoredUserConfig: true;
      ignoredRules: true;
      emptyWorkspace: true;
    }
  | {
      status: "blocked";
      adapter: "standalone-codex" | "hermes-validator";
      code:
        | "blocked-no-context-isolation"
        | "blocked-no-validator-tool-seam"
        | "blocked-model-identity-unproven"
        | "blocked-receipt-invalid";
    };
```

Blocked lanes remain visible in adapter/model-level aggregate status but contribute no fixture
accuracy or selection result. The sanitized report contains adapter/model/status, blocker code or
receipt digest, fixture IDs, classifications, and metrics only—never prompts, raw events, candidate
output, paths, marker values, or private text.

Measure:

- repair versus unrepairable classification accuracy;
- protected-digest preservation;
- target-schema validity;
- authoritative validity;
- exact expected structural diff;
- added/removed content-token counts;
- first-submission and corrected-submission success;
- provider API calls, validator calls, runtime, and token use;
- adapter identity and isolation regime;
- stability on a small repeated subset.

A model passes only with:

- 100 percent protected-semantic preservation;
- 100 percent rejection of negative fixtures;
- no false `repairable` result;
- valid target output for every positive fixture.

Luna is excluded from the comparative validator gate after the bounded diagnostics showed that it
can perform a plain exact-envelope repair but is unreliable as the controller of the iterative
validator protocol. Run Terra first, then Sol as the matched orchestration control. For each model,
run the standalone Codex control and Hermes validator candidate against frozen bytes. Do not tune
between adapters or models.

Selection is complexity-aware:

- if standalone Codex and Hermes both pass every safety gate, select standalone Codex;
- if only Hermes passes, retain the validator bridge;
- if both are safe but Hermes accepts materially more positive fixtures, report the exact recovery,
  latency, token, and maintenance trade-off before selecting it;
- if neither passes, reject automatic production repair.

The selected adapter/model is not wired into production until this gate passes and Phase B receives
a separate approved plan.

## Testing Strategy

### Pure tests

- classifier issue mapping and bounds;
- failure eligibility matrix;
- protected projection canonicalization;
- review/suspicion flag-location equivalence;
- lexical token inventory and truncation rejection;
- repair-envelope strictness;
- protected-digest mismatch rejection;
- one-attempt state transition and metrics.

### Synthetic formatter tests

Injected formatter responses prove:

- one repair session only and at most two validator calls;
- no call for ineligible failures;
- repaired schema accepted only with protected equality;
- unrepairable envelope stops cleanly;
- malformed repair output stops cleanly;
- original diagnostics preserved;
- repaired diagnostics separate;
- canonical publication remains atomic.

### Live fixture gate

Run one Terra canary through both exact adapters, freeze and hash the complete matched packet, then
run the synthetic and private fixture corpus through Terra followed by Sol. Do not use a full August
15 reconciliation run as the first formatter test.

### Integration tests after Phase A approval

Phase B adds focused runner tests for repair success, unrepairable failure, formatter timeout,
digest mismatch, and cache-identical resume. Then run the complete CLI suite, typecheck, build, and
diff checks.

## Security and Privacy

- Private raw/repaired outputs remain owner-only in isolated diagnostics.
- Reports contain classifications and metrics, not transcript text or raw errors.
- The Hermes candidate can access only the pure candidate validator; it cannot access files,
  network, repository context, memory, credentials, shell, transcript sources, or generic tools.
- The standalone Codex control receives no repository/transcript files beyond the inline repair
  packet. It runs ephemerally in an empty read-only sandbox with ignored user configuration/rules
  and an exact output schema. If its ordinary agent capability or credential custody cannot be
  proven acceptably isolated, mark that adapter blocked.
- Repair output is untrusted until all deterministic checks pass.
- Source receipt, cache identity, filesystem containment, and canonical publication rules are
  unchanged.

## Acceptance Criteria

Phase A is complete when:

1. strict repair payload/result schemas exist;
1. classifier and protected-projection logic pass focused tests;
1. synthetic positive and negative fixtures pass deterministically;
1. private live fixtures are inventoried without publication;
1. matched standalone-Codex and Hermes receipts identify the actual serving adapter and model;
1. Terra and Sol are compared on frozen matched packets without between-lane tuning;
1. at least one adapter/model pair passes every safety gate, or the feature is honestly rejected as
   unsuitable;
1. no production reconciliation path calls the formatter.

Phase B is complete when:

1. exactly one eligible repair attempt can occur per failed chunk;
1. ineligible failures make zero formatter calls;
1. protected semantic equality and authoritative validation gate canonical publication;
1. repaired canonicals are marked `needs_review` with provenance;
1. calls/retries and diagnostics are truthful;
1. cache-identical resume reuses prior chunks and retries only the failed chunk;
1. full CLI tests, typecheck, build, and independent review pass;
1. a fresh isolated August 15 candidate run completes without automatic promotion.
