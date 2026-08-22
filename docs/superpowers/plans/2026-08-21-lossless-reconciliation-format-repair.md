# Lossless Reconciliation Format Repair Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build and verify the Phase A lossless format-repair core, synthetic fixture harness, and
matched model bake-off without changing production reconciliation behavior.

**Architecture:** Add a standalone TypeScript module that converts bounded JSON/Zod failures into a
closed repair contract, protects semantic content with canonical projections or lexical inventories,
and verifies a single injected formatter result. Add committed synthetic fixtures and a separate
harness that exposes exactly one pure candidate-validator tool. Gate development on Luna, then
freeze the passing configuration before evaluating Terra and Sol unchanged. Keep
`runUnifiedReconciliation` untouched in Phase A; Phase B receives a separate plan only after the
fixture safety gate passes.

**Tech Stack:** TypeScript 6, Node.js test runner, Zod 4, Node crypto/fs/process APIs, existing
`stableHash` and reconciliation schemas, and an isolated Hermes invocation whose only available tool
is the local candidate validator.

---

## Stable Boundary Packet

Repeat this packet verbatim in every implementation or review delegation:

- Worktree:
  `/home/ensu/Projects/bastion-falls-astro/.worktrees/unified-transcript-reconciliation`
- Branch: `feat/unified-transcript-reconciliation`
- Approved design:
  `docs/superpowers/specs/2026-08-21-lossless-reconciliation-format-repair-design.md`
- Phase A may modify only the paths named by its current task.
- Phase A must not modify `reconciliationRunner.ts`, production CLI registration,
  checkpoint/pipeline code, benchmark lane orchestration, canonical August 15 artifacts, or any
  public archive path.
- No production formatter call is allowed in Phase A.
- Synthetic fixtures contain no private campaign text, names, credentials, paths, or copied live
  diagnostics.
- Private live diagnostics remain read-only under ignored trial roots and are never committed.
- The formatter may repair representation only. Protected text, source-event references, omission
  reasons, correction replacements/evidence, attribution, identities, and summary-safe content must
  remain unchanged.
- Repair-session count is fixed at one. The sole validator tool may be called at most twice: initial
  submission plus one correction. Do not add configurable retries.
- No commit may claim the model bake-off passed without receipts proving the actual serving model,
  the exact singleton validator-tool inventory, safe mode, an empty invocation cwd, no profile, and
  ignored user configuration/rules.
- If current Hermes cannot expose exactly the validator tool while excluding every other tool, stop
  the live bake-off and report that blocker. Do not weaken this to “no other tools happened to be
  called.”
- Do not commit, push, reset, checkout, clean, install dependencies, or invoke live models unless
  the task explicitly authorizes that side effect.
- Focused verification uses direct package-local commands when Corepack/pnpm is unreliable:
  `node --import tsx --test ...`,
  `node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit`, and
  `node scripts/build.mjs`.

## Phase A Stop Conditions

Stop Phase A immediately and do not begin Phase B when any of these is true:

- a negative fixture is falsely classified or returned as repairable;
- any accepted repair changes its protected projection/digest or lexical content inventory;
- target response or authoritative validation fails after repair;
- the live invocation cannot prove the requested serving model;
- the live invocation cannot prove that the validator was the only available tool;
- the live invocation cannot prove profile/rules/user configuration were ignored and its cwd was an
  empty owner-only directory;
- no tested model passes every positive and negative fixture;
- implementation would require modifying production reconciliation behavior.

### Task 1: Define Strict Repair Contracts

**Objective:** Create the bounded public TypeScript schemas and types used by all Phase A repair
logic.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationRepair.ts`
- Create: `cli/src/commands/transcribe/reconciliationRepair.test.ts`
- Read only: `cli/src/commands/transcribe/reconciliation.ts`
- Read only: `cli/src/commands/transcribe/reconciliationEvidence.ts`

#### Step 1: Write the failing schema tests

Add tests covering:

- all five failure classifications;
- the seven initial repair issue codes;
- strict rejection of unknown keys;
- path depth, path segment, issue count, enum-list, original-output, and digest bounds;
- strict repaired and unrepairable envelopes;
- rejection of freeform unrepairable reasons;
- UTF-8 byte bounds in addition to Zod character bounds.

Use concrete desired exports:

```ts
import {
  RepairClassificationSchema,
  RepairEnvelopeSchema,
  RepairIssueSchema,
  RepairPayloadSchema,
  assertRepairPayloadBytes,
} from "./reconciliationRepair.js";
```

The valid contract shape is:

```ts
const issue = {
  stage: "schema",
  code: "invalid-enum-location",
  path: ["blocks", 0, "reviewFlags", 0],
  actualValue: "unsupported-proper-noun",
  allowedValues: ["ambiguous-speaker"],
  sameValueAllowedAt: [["suspicionFlags"]],
};

const payload = {
  repairVersion: 1,
  targetSchemaVersion: "reconciliation.v1",
  originalOutput: "{}",
  classification: "repairable-format",
  issues: [issue],
  protection: {
    kind: "projection",
    value: {},
    digest: "0".repeat(64),
  },
};
```

#### Step 2: Run the focused test and verify RED

Run:

```bash
cd cli
node --import tsx --test src/commands/transcribe/reconciliationRepair.test.ts
```

Expected: FAIL because `reconciliationRepair.ts` and its exports do not exist.

#### Step 3: Implement the minimal strict schemas

Define these constants and contracts in `reconciliationRepair.ts`:

```ts
export const REPAIR_VERSION = 1 as const;
export const REPAIR_PROMPT_VERSION = "reconciliation.format-repair.v1" as const;
export const MAX_REPAIR_OUTPUT_BYTES = 2_000_000;
export const MAX_REPAIR_ISSUES = 32;
export const MAX_REPAIR_PATH_DEPTH = 16;

export const RepairClassificationSchema = z.enum([
  "repairable-format",
  "unrepairable-semantic",
  "unrepairable-incomplete",
  "unrepairable-identity",
  "unrepairable-security",
]);

export const RepairIssueCodeSchema = z.enum([
  "invalid-json",
  "invalid-enum-location",
  "unrecognized-key",
  "missing-empty-collection",
  "optional-field-presence",
  "invalid-escaping",
  "nonsemantic-framing",
]);
```

Use a scalar-only `actualValue` schema. Do not accept arbitrary nested model content in an issue.
Define the repaired envelope as a strict discriminated union:

```ts
export const RepairEnvelopeSchema = z.discriminatedUnion("repairable", [
  z.object({ repairable: z.literal(true), repairedOutput: z.unknown() }).strict(),
  z.object({
    repairable: z.literal(false),
    reason: z.enum([
      "semantic-change-required",
      "incomplete-original",
      "identity-change-required",
      "unsupported-repair",
    ]),
  }).strict(),
]);
```

`assertRepairPayloadBytes` must measure `Buffer.byteLength(JSON.stringify(value), "utf8")` and
reject non-serializable or oversized payloads.

#### Step 4: Run the focused test and verify GREEN

Run the focused test again. Expected: PASS.

#### Step 5: Run typecheck and diff checks

```bash
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
git -C .. diff --check
```

Expected: both pass.

#### Step 6: Commit

```bash
git add cli/src/commands/transcribe/reconciliationRepair.ts \
  cli/src/commands/transcribe/reconciliationRepair.test.ts
git commit -m "feat(transcribe): define format repair contracts"
```

### Task 2: Build Protected Semantic Projections

**Objective:** Canonicalize all model-owned semantic fields while excluding only deterministic
source echoes and permitted enum-location differences.

**Files:**

- Modify: `cli/src/commands/transcribe/reconciliationRepair.ts`
- Modify: `cli/src/commands/transcribe/reconciliationRepair.test.ts`
- Read only: `cli/src/commands/transcribe/reconciliation.ts:42-83`

#### Step 1: Write failing projection tests

Add tests for:

- key order and whitespace independence;
- exact preservation of chunk/cache identity;
- block order, IDs, text, summary-safe text, kind, source IDs, channel/speaker, character
  attribution, and attribution basis;
- exact omission IDs/reasons;
- exact correction IDs/replacements/evidence;
- exact review notes and summary-safety content;
- exclusion of block/omission timestamps and correction `sourceForm`;
- equality when one existing suspicion enum moves from an invalid block `reviewFlags` location to
  top-level `suspicionFlags`;
- inequality when a flag is added, removed, or duplicated;
- equality only for schema-approved missing-versus-empty collections;
- inequality for any protected string or event-reference change.

Use desired exports:

```ts
const before = buildProtectedProjection(parseableInvalidObject);
const after = buildProtectedProjection(repairedObject);
assert.equal(protectedDigest(before), protectedDigest(after));
```

#### Step 2: Run focused tests and verify RED

Expected: missing projection exports.

#### Step 3: Implement the projection

Define an explicit `ProtectedProjectionSchema`; do not use unconstrained recursive `unknown` values.
The builder accepts a JSON object that may fail the strict response schema but must have
recognizable bounded top-level reconciliation structure.

Canonicalize the combined flag inventory as records that preserve value multiplicity while
permitting only the design-approved location repair:

```ts
type ProtectedFlag = { value: string; count: number };
```

Keep arrays ordered unless the approved design explicitly says otherwise. Hash projections with the
existing `stableHash` from `reconciliationEvidence.ts` after strict projection parsing.

Unknown top-level keys must not be silently discarded here. The classifier may authorize removal
only for a closed nonsemantic key allowlist introduced by a real fixture; begin with model-supplied
`status` only.

#### Step 4: Run focused tests and verify GREEN

Expected: all projection tests pass.

#### Step 5: Run typecheck and commit

```bash
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
git -C .. diff --check
git add cli/src/commands/transcribe/reconciliationRepair.ts \
  cli/src/commands/transcribe/reconciliationRepair.test.ts
git commit -m "feat(transcribe): protect repair semantics"
```

### Task 3: Normalize and Classify Parseable Zod Failures

**Objective:** Convert parser and response-schema failures into compact machine-actionable issues
without passing raw exception prose or semantic failures to a formatter.

**Files:**

- Modify: `cli/src/commands/transcribe/reconciliationRepair.ts`
- Modify: `cli/src/commands/transcribe/reconciliationRepair.test.ts`
- Read only: `cli/src/commands/transcribe/reconciliation.ts:77-94`
- Read only: `cli/src/commands/transcribe/reconciliationRunner.ts:99-112`

#### Step 1: Write the failing classification matrix

Use real Zod 4 issue shapes produced by `ReconciliationResponseSchema.safeParse` and test:

- wrong known enum in `blocks[*].reviewFlags` maps to `invalid-enum-location`, including the exact
  path, actual value, allowed values, and legal top-level destination;
- model-supplied top-level `status` maps to repairable `unrecognized-key`;
- any other unknown key is initially unrepairable until explicitly allowlisted;
- missing `reviewNotes`, `suspicionFlags`, `materialCorrections`, `omissions`, or
  `summarySafety.errors` maps to `missing-empty-collection` only when absence semantically equals an
  empty collection;
- optional-field presence errors map only when removal/addition preserves the protected projection;
- overlong text maps to `unrepairable-semantic`;
- every JSON parse failure remains `unrepairable-incomplete` in this task because lexical
  completeness has not yet been implemented;
- unknown event IDs, missing accounting, echoed identity mismatch, timeout, empty output, and source
  security errors are ineligible;
- issue output is bounded and does not contain raw identifiers, source text, stack traces, paths, or
  credentials.

#### Step 2: Run focused tests and verify RED

Expected: missing classifier exports.

#### Step 3: Implement normalized classification

Add:

```ts
export interface RepairFailureInput {
  originalOutput: string;
  parsedValue?: unknown;
  parseError?: unknown;
  zodIssues?: readonly z.ZodIssue[];
  validationError?: unknown;
}

export function classifyRepairFailure(input: RepairFailureInput): RepairClassificationResult;
```

The result must always validate through a strict internal schema before being returned. Match errors
by typed issue code/path and explicit error classes/codes where available, never broad substring
rules against private model content.

Do not classify authoritative failures from `validateReconciliation` as formatting. Phase A may
accept an explicit caller-supplied failure category for those errors rather than parsing error text.

#### Step 4: Run focused tests and verify GREEN

Expected: the entire eligibility matrix passes.

#### Step 5: Verify and commit

```bash
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
git -C .. diff --check
git add cli/src/commands/transcribe/reconciliationRepair.ts \
  cli/src/commands/transcribe/reconciliationRepair.test.ts
git commit -m "feat(transcribe): classify format repair failures"
```

### Task 4: Add Bounded Lexical Preservation and Invalid-JSON Eligibility

**Objective:** Permit syntax-only JSON recovery only when all recoverable content tokens can be
proven complete and unchanged.

**Files:**

- Modify: `cli/src/commands/transcribe/reconciliationRepair.ts`
- Modify: `cli/src/commands/transcribe/reconciliationRepair.test.ts`

#### Step 1: Write failing lexical-inventory tests

Cover:

- missing comma with complete strings/numbers/booleans/nulls is inventoryable;
- Markdown fences and known framing are inventoryable after deterministic framing removal;
- escaped quote, backslash, newline, and Unicode preservation;
- unterminated string is incomplete;
- trailing partial number/exponent is incomplete;
- missing closing braces after complete tokens is repairable only when the token inventory is
  complete;
- arbitrary prose mixed into output is unrepairable unless it matches a closed framing rule;
- repaired ordered content-token sequence mismatch rejects;
- malformed-JSON repair may change punctuation and escaping only; it may not relocate keys or
  values;
- enum/key relocation is eligible only for parseable originals protected by Task 2 projections, not
  for lexical invalid-JSON repair;
- input bytes, token count, token length, nesting depth, and scan runtime are bounded.

#### Step 2: Run focused tests and verify RED

Expected: missing lexical exports.

#### Step 3: Implement a finite-state scanner

Add:

```ts
export type LexicalToken =
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" };

export function inventoryInvalidJson(input: string): LexicalInventoryResult;
export function verifyLexicalPreservation(before: LexicalInventory, repaired: unknown): void;
```

Use a deterministic single-pass scanner. Do not use regex-only JSON token extraction. Preserve the
exact ordered sequence of decoded string tokens and original number/boolean/null lexemes. This is
intentionally stricter than a multiset: malformed JSON may repair syntax/escaping but may not
reorder semantic tokens. Preserve number lexemes so `1`, `1.0`, and `1e0` are not silently treated
as identical unless the design is explicitly amended.

Extend `classifyRepairFailure` only after the scanner exists. `invalid-json` becomes
`repairable-format` only when `inventoryInvalidJson` returns a complete bounded inventory; otherwise
classification remains `unrepairable-incomplete` and the formatter is not called.

#### Step 4: Run focused tests and verify GREEN

Expected: all valid, malformed, truncated, and bound cases pass.

#### Step 5: Verify and commit

```bash
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
git -C .. diff --check
git add cli/src/commands/transcribe/reconciliationRepair.ts \
  cli/src/commands/transcribe/reconciliationRepair.test.ts
git commit -m "feat(transcribe): verify malformed JSON content"
```

### Task 5: Verify One Injected Formatter Result

**Objective:** Build the pure Phase A repair evaluator that accepts one injected formatter call and
proves target, identity, semantic, and authoritative validity without publishing canonical output.

**Files:**

- Modify: `cli/src/commands/transcribe/reconciliationRepair.ts`
- Modify: `cli/src/commands/transcribe/reconciliationRepair.test.ts`
- Read only: `cli/src/commands/transcribe/reconciliationRunner.ts:109-165`

#### Step 1: Write failing evaluator tests

Define the desired seam:

```ts
export type InvokeFormatRepair = (input: {
  prompt: string;
  payload: RepairPayload;
  signal: AbortSignal;
}) => Promise<RepairInvocationResult | string>;

export interface RepairValidationInput {
  packet: ReconciliationEvidencePacket;
  authoritativeSourceEvents: readonly SourceEvent[];
}

export async function evaluateFormatRepair(options: {
  originalOutput: string;
  validation: RepairValidationInput;
  invoke: InvokeFormatRepair;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<RepairEvaluation>;
```

Tests must prove:

- ordinary valid output makes zero formatter calls;
- ineligible failure makes zero calls;
- eligible failure makes exactly one call;
- `repairable: false` stops cleanly;
- malformed repair envelope stops cleanly;
- timeout/overflow aborts and never retries;
- repaired schema parses strictly;
- exact chunk/cache/prompt/schema identity is required;
- projection or lexical digest mismatch rejects;
- authoritative validation runs from scratch;
- accepted output is forced to `needs_review` in the evaluation result;
- the evaluator returns an unpersisted candidate plus validation/protection evidence; it does not
  publish a production canonical artifact;
- evaluation reports `calls: 2`, `retries: 1` only for accepted repair;
- injected formatter cannot override metrics, classification, identity, or validation status.

#### Step 2: Run focused tests and verify RED

Expected: evaluator exports are missing.

#### Step 3: Implement the fixed repair prompt and evaluator

The prompt must include only:

- fixed lossless repair instruction;
- compact exact v1 format contract;
- normalized bounded issues;
- original output;
- protected projection/digest or lexical inventory.

It must explicitly forbid tools, external context, content rewriting, and explanation. It must
request the strict repair envelope only.

Do not import `ReconciliationChunkJob` from the production runner: that would create a circular
module dependency when Phase B wires repair into the runner. Define `RepairValidationInput` locally
from `ReconciliationEvidencePacket` and `SourceEvent`. Reuse the canonical validation boundary by
exporting or extracting a pure compiler from `reconciliationRunner.ts` only in Phase B. In Phase A,
the evaluator may call `parseReconciliationResponse`, compare packet identities directly, and call
`validateReconciliation` with authoritative events. Do not modify `reconciliationRunner.ts` yet.

#### Step 4: Run focused tests and verify GREEN

Expected: one-attempt and zero-call stop rules pass.

#### Step 5: Run full package gates and commit

```bash
node --import tsx --test src/**/*.test.ts
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
node scripts/build.mjs
git -C .. diff --check
```

Expected: all pass.

```bash
git add cli/src/commands/transcribe/reconciliationRepair.ts \
  cli/src/commands/transcribe/reconciliationRepair.test.ts
git commit -m "feat(transcribe): evaluate one format repair"
```

### Task 6: Add the Committed Synthetic Fixture Corpus

**Objective:** Encode matched positive and negative repair examples without private transcript data
or model calls.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationRepairFixtures.ts`
- Create: `cli/src/commands/transcribe/reconciliationRepairFixtures.test.ts`
- Modify only if required: `cli/src/commands/transcribe/reconciliationRepair.ts`

#### Step 1: Write the failing fixture-schema test

Define a strict `RepairFixtureSchema` with:

```ts
{
  id: string;
  expectation: "repair" | "unrepairable";
  originalOutput: string;
  expectedIssueCodes: RepairIssueCode[];
  expectedRepairedOutput?: unknown;
  expectedUnrepairableReason?: z.infer<typeof RepairUnrepairableReasonSchema>;
}
```

Require unique bounded IDs and fixture-count limits.

#### Step 2: Add synthetic positive fixtures

Use neutral text such as `Speaker A said hello.` and synthetic IDs. Include:

- wrong enum location;
- allowlisted model-supplied `status` key;
- missing empty collection;
- Markdown/known framing;
- missing comma;
- recoverable escaping;
- optional-field presence.

Every positive fixture includes an exact expected structural result.

#### Step 3: Add synthetic negative fixtures

Include:

- invented source ID;
- missing event accounting;
- changed readable text;
- changed summary-safe text;
- changed correction replacement/evidence;
- changed attribution;
- truncated object;
- empty output;
- identity mismatch;
- overlong semantic text requiring rewriting.

#### Step 4: Run the fixture tests and verify failures are meaningful

The initial fixture test invokes a deliberately minimal fake formatter. Expected RED should identify
missing fixture behavior, not malformed fixture data.

#### Step 5: Complete the injected fixture runner

Add a test-only helper that runs each fixture through classification and `evaluateFormatRepair` with
an injected result. Assert exact issue codes, exact expected output, negative rejection, protected
equality, and one-call limits.

#### Step 6: Verify and commit

```bash
node --import tsx --test \
  src/commands/transcribe/reconciliationRepair.test.ts \
  src/commands/transcribe/reconciliationRepairFixtures.test.ts
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
git -C .. diff --check
git add cli/src/commands/transcribe/reconciliationRepairFixtures.ts \
  cli/src/commands/transcribe/reconciliationRepairFixtures.test.ts \
  cli/src/commands/transcribe/reconciliationRepair.ts
git commit -m "test(transcribe): add format repair fixtures"
```

### Task 7: Build the Isolated Formatter Bake-Off Harness

**Objective:** Run the exact same fixtures through an injected formatter command, record sanitized
receipts, and refuse live execution unless model identity and singleton-validator custody are
provable.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationRepairHarness.ts`
- Create: `cli/src/commands/transcribe/reconciliationRepairHarness.test.ts`
- Read only: `cli/src/commands/transcribe/reconciliationRepairFixtures.ts`
- Do not modify: `cli/src/commands/transcribe/command.ts`

#### Step 1: Write failing harness contract tests

Define:

```ts
export interface FormatterAdapter {
  identity: { provider: string; model: string };
  invoke(input: {
    prompt: string;
    timeoutMs: number;
    maxOutputBytes: number;
    scratchDir: string;
  }): Promise<{
    stdout: string;
    usage: {
      provider: string;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      apiCalls: number;
      toolAvailability: "validator-only";
      availableTools: ["validate_repair_json"];
      toolCalls: 1 | 2;
    };
  }>;
}
```

Define strict `PhaseARepairReportSchema` and `PhaseAModelResultSchema` contracts. The report status
is `passed | failed | blocked`; blocked results require one fixed reason such as
`blocked-no-validator-tool-seam` or `blocked-no-context-isolation`. Reports contain fixture IDs and
metrics only, never model output or private text.

Tests prove:

- canonical fixture order and identical payload per model;
- separate owner-only scratch/result roots;
- no raw output, transcript text, errors, paths, prompts, or credentials in reports;
- actual usage identity must equal requested identity;
- any tool inventory other than exactly `validate_repair_json` rejects the run;
- zero validator calls or more than two validator calls rejects the fixture;
- the last valid tool argument, not assistant prose, is the authoritative candidate;
- later models continue after ordinary fixture failure;
- report statuses distinguish pass, fail, and blocked;
- exact 100 percent positive/negative gate calculation;
- no production files or canonical artifacts are imported or written.

#### Step 2: Run focused tests and verify RED

Expected: harness module missing.

#### Step 3: Implement injected harness and transactional reports

Write owner-only per-model raw receipts and repaired candidate artifacts under an ignored
operator-selected scratch root. For every accepted repair, atomically publish the isolated
candidate, reread it, re-run target/protection/identity/authoritative validation, and only then
record fixture success. These are Phase A candidate artifacts, never production canonicals. Publish
a sanitized `phase-a-report.json` and `phase-a-report.md` pair after all requested models finish or
when preflight blocks the run. Use same-parent temporary files, file sync, rename, and directory
sync, following `reconciliationBenchmark.ts` report custody.

Do not register a public `bfcli` command in Phase A. Expose a callable function and a package-local
script entry only if needed for the live bake-off.

#### Step 4: Prove subprocess lifecycle with a synthetic executable

Use a generated Node executable, not real Hermes, to test:

- success;
- timeout and TERM/KILL cleanup;
- oversized stdout/usage files;
- wrong model receipt;
- tool availability/call violation;
- interruption before report publication;
- no process or temporary-file debris.

#### Step 5: Verify and commit

```bash
node --import tsx --test \
  src/commands/transcribe/reconciliationRepairHarness.test.ts
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
node scripts/build.mjs
git -C .. diff --check
git add cli/src/commands/transcribe/reconciliationRepairHarness.ts \
  cli/src/commands/transcribe/reconciliationRepairHarness.test.ts
git commit -m "feat(transcribe): add format repair bakeoff harness"
```

### Task 8: Inventory Private Live Fixtures Without Committing Content

**Objective:** Convert the existing ignored diagnostics into a bounded local fixture manifest while
keeping all private bytes outside Git.

**Files:**

- Create locally under ignored trial storage only:
  `astro/.bf-transcripts/.trials/session-2026-08-15-unified-reconciliation/format-repair-fixtures/`
- Do not create or modify tracked files unless a synthetic fixture class is missing.

#### Step 1: Select observed diagnostics

Use the real enum-location, Hermes framing, and other complete formatting failures. Exclude timeout,
empty, truncated, identity-drifted, and authoritative semantic failures from positive fixtures.

#### Step 2: Produce a private bounded manifest

Record only local relative diagnostic paths, expected classification, expected issue codes, byte
size, and SHA-256. Do not copy transcript snippets into the manifest.

#### Step 3: Verify custody

Prove:

- every source is beneath the isolated trial root;
- no symlink or non-regular file is followed;
- per-file and aggregate byte limits hold;
- no private fixture path is tracked by Git;
- the canonical August 15 receipt remains unchanged.

#### Step 4: Stop if a required positive class has no complete real fixture

Synthetic coverage remains valid, but do not claim private live coverage for a class without
evidence. Do not manufacture a “real” fixture.

### Task 9: Prove or Reject a Validator-Only Live Adapter

**Objective:** Establish a formatter invocation that gives the model exactly one pure candidate
validator, no rules/memory/profile/repository context, an explicit model, and a durable usage
receipt before spending on the bake-off.

**Files:**

- Modify only if a proven adapter can be implemented:
  `cli/src/commands/transcribe/reconciliationRepairHarness.ts`
  `cli/src/commands/transcribe/reconciliationRepairHarness.test.ts`
- No Hermes profile/config edits.

#### Step 1: Preflight current Hermes one-shot behavior

The installed CLI supports:

```text
hermes -z PROMPT -m MODEL --usage-file PATH --safe-mode
```

but the adapter must establish a bounded tool seam that exposes only `validate_repair_json`.
`--safe-mode` disables user config, rules, plugins, and MCP customization but does not by itself
prove the built-in tool list has been replaced by the singleton validator.

#### Step 2: Require proof, not inference

A usable adapter must produce a machine-readable receipt proving:

- actual provider/model;
- available tools were exactly `["validate_repair_json"]`;
- validator calls were one or two for each fixture;
- API/token usage;
- bounded process completion.

The launcher must also prove context isolation deterministically:

- invoke `hermes -z` with `--safe-mode`, which implies ignored user configuration and rules;
- pass no profile or skills;
- run from a newly created owner-only empty cwd outside the repository and trial fixture roots;
- pass the complete repair prompt directly, with no file/repository reference;
- use an explicit allowlisted environment and no project-local environment variables;
- verify the cwd remained empty except for invocation-owned usage/receipt files;
- record these facts as strict booleans in the adapter receipt.

If Hermes cannot provide that proof without profile mutation, private credential copying, or an
unbounded plugin/tool surface, mark the adapter `blocked-no-validator-tool-seam` and stop
before Task 10. If tool isolation works but context isolation cannot be proven, use
`blocked-no-context-isolation`. Publish the strict Phase A report pair through the Task 7 report
writer before stopping. Do not weaken the design.

#### Step 3: If and only if proof is possible, add the adapter

Use argv spawning with `shell: false`, owner-only prompt/usage files, detached process-group
cleanup, explicit `-m`, no fallback model, strict timeout/output bounds, and exact usage receipt
parsing.

#### Step 4: Verify with a minimal Luna canary

Run one minimal synthetic prompt. Read back the durable usage receipt and independently verify Luna,
safe-mode/context flags, empty cwd custody, the singleton validator inventory, and captured valid
tool arguments. Any ambiguity blocks the bake-off and publishes a blocked report.

#### Step 5: Commit only a proven adapter

If blocked, commit no speculative adapter. Publish the fixed blocker through `phase-a-report.json`
and its matching Markdown report instead of adding dead configuration.

### Task 9A: Add the Pure Candidate-Validator Script and Sealed Submission Contract

**Objective:** Validate only the JSON candidate supplied by the model, return bounded compiler-style
feedback, and make the last valid tool argument authoritative without invoking a live model.

**Files:**

- Create: `cli/src/commands/transcribe/reconciliationRepairValidatorTool.ts`
- Create: `cli/src/commands/transcribe/reconciliationRepairValidatorTool.test.ts`
- Modify: `cli/src/commands/transcribe/reconciliationRepairHarness.ts`
- Modify: `cli/src/commands/transcribe/reconciliationRepairHarness.test.ts`

#### Step 1: Write failing pure-validator tests

Cover exact repaired and unrepairable envelopes, unknown keys, malformed target output, identity
change, protected-semantic change, source-event-accounting failure, valid first submission, invalid
first plus valid correction, two invalid submissions, a forbidden third call, and bounded issue
paths and codes. Prove accessors, symbols, non-plain prototypes, oversized JSON, and
non-serializable input are rejected without executing getters.

The script-facing result is a strict union:

```ts
type RepairValidationResult =
  | { valid: true; submissionNumber: 1 | 2 }
  | {
      valid: false;
      submissionNumber: 1 | 2;
      issues: readonly { code: string; path: readonly (string | number)[] }[];
    };
```

No issue may contain raw candidate values, transcript text, paths, exception prose, or credentials.

#### Step 2: Run focused tests and verify RED

```bash
cd cli
node --import tsx --test \
  src/commands/transcribe/reconciliationRepairValidatorTool.test.ts \
  src/commands/transcribe/reconciliationRepairHarness.test.ts
```

Expected: FAIL because the validator-tool module and sealed-submission interface do not exist.

#### Step 3: Implement the pure validator and bounded call ledger

Reuse `RepairEnvelopeSchema` and `evaluateFormatRepair`; do not duplicate reconciliation validation.
The model-visible argument is only the envelope candidate. The harness closes over the frozen
original output and deterministic validation authority. Record a descriptor-only plain-data snapshot
before validation. Permit at most two calls. Capture the exact last valid snapshot as the sealed
candidate; do not accept later prose or a separately serialized copy.

Expose a stdin/stdout script entry that accepts one bounded internal request, invokes the same pure
validator, and emits only `RepairValidationResult`. The live adapter may wrap this script as the
sole tool handler, but this task does not launch Hermes or modify a profile.

#### Step 4: Update harness metrics and reports

Record provider API calls separately from validator calls, plus first-submission and
corrected-submission acceptance counts. Keep reports sanitized. A fixture fails when there is no
valid submission, more than two calls, malformed tool metadata, or a final candidate that differs
from the sealed tool argument.

Build the model-facing payload only from original output, deterministic classification, and
normalized issue codes. Never include fixture IDs or expected result fields. Keep the four
indistinguishable semantic-drift fixtures (`changed-readable-text`, `changed-summary-safe-text`,
`changed-correction`, and `changed-attribution`) in the deterministic validator matrix but exclude
them from model calls; identical prompts must never be scored against contradictory expected
answers.

#### Step 5: Verify and commit

```bash
node --import tsx --test \
  src/commands/transcribe/reconciliationRepair.test.ts \
  src/commands/transcribe/reconciliationRepairFixtures.test.ts \
  src/commands/transcribe/reconciliationRepairValidatorTool.test.ts \
  src/commands/transcribe/reconciliationRepairHarness.test.ts
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
node scripts/build.mjs
git -C .. diff --check
git add \
  src/commands/transcribe/reconciliationRepairValidatorTool.ts \
  src/commands/transcribe/reconciliationRepairValidatorTool.test.ts \
  src/commands/transcribe/reconciliationRepairHarness.ts \
  src/commands/transcribe/reconciliationRepairHarness.test.ts
git commit -m "feat(transcribe): validate formatter tool submissions"
```

### Task 10: Pass Luna, Freeze the Seam, Then Compare Terra and Sol

**Objective:** Select the cheapest safe formatter or reject model repair before production wiring.

**Prerequisite:** Task 9 proved a validator-only invocation. Otherwise this task is blocked and
Phase A ends honestly.

**Files:**

- Write only under a new isolated ignored trial root.
- Do not modify tracked source during the bake-off.

#### Step 1: Freeze the fixture receipt

Hash the exact synthetic fixture module/build identity and private fixture manifest. Record the
repair prompt version and schema version.

#### Step 2: Run Luna only until the gate passes

Run every positive and negative fixture with the same bounds. Repeat a small representative subset
to measure stability. Verify actual model identity from receipts. Compare the explicit plain-JSON
control with validator-tool submission. If Luna fails, inspect only Luna receipts, repair only
generic prompt/tool/validator defects, and rerun Luna. Do not invoke Terra or Sol yet, and do not
add fixture-specific hints or model-name branches.

#### Step 3: Freeze the passing Luna configuration

Hash and record the exact prompt, tool schema/script, validator implementation, fixture corpus and
order, and execution bounds. Make no further tuning during comparative runs.

#### Step 4: Run Terra and Sol unchanged

Use the same frozen matched packet, order, bounds, and repeated subset. Do not let either model
receive extra context, calls, retries, or between-model tuning.

#### Step 5: Compute the gate in code

A passing model requires:

- every positive fixture returns the exact accepted repair;
- every negative fixture returns unrepairable or is deterministically rejected;
- zero protected-digest/lexical mismatches;
- zero false `repairable` outcomes;
- target and authoritative validation pass for every accepted repair;
- actual model and singleton-validator receipts are valid;
- every fixture uses one repair session and no more than two validator calls.

#### Step 6: Inspect private live fixtures

Review exact diffs locally. Do not publish transcript text in the report.

#### Step 7: Publish sanitized results

Report pass/fail, fixture IDs, classifications, runtime, tokens, API calls, model identity, and
aggregate accuracy only.

#### Step 8: Stop at the Phase A gate

- If no model passes, reject production repair and return to ordinary failed-chunk recovery.
- If at least one passes, select the lowest-cost/latency passing model.
- Do not begin Phase B in the same task.

### Task 11: Final Phase A Verification and Review

**Objective:** Prove the tracked implementation is complete, safe, and still disconnected from
production reconciliation.

**Files:**

- Review all Phase A changed paths.
- Do not modify production paths except to fix a proven Phase A defect.

#### Step 1: Run the focused repair suite

```bash
cd cli
node --import tsx --test \
  src/commands/transcribe/reconciliationRepair.test.ts \
  src/commands/transcribe/reconciliationRepairFixtures.test.ts \
  src/commands/transcribe/reconciliationRepairHarness.test.ts
```

Expected: all pass.

#### Step 2: Run full package gates

```bash
node --import tsx --test src/**/*.test.ts
node node_modules/typescript/bin/tsc -p src/tsconfig.json --noEmit
node scripts/build.mjs
git -C .. diff --check
```

Expected: all pass.

#### Step 3: Prove production disconnection

Search all production callers and assert:

- `runUnifiedReconciliation` does not import or call repair code;
- CLI/config/checkpoint/pipeline files have no formatter settings;
- no repair model is selected in production;
- no canonical artifact contains repair provenance yet.
- every accepted Phase A candidate artifact was atomically published, reread, and revalidated under
  the isolated scratch root;
- `phase-a-report.json` strictly records `passed`, `failed`, or `blocked` and its Markdown pair
  agrees.

#### Step 4: Obtain two independent reviews

Review 1: exact design/spec compliance, classification boundaries, fixture gate, and Phase A stop
conditions.

Review 2: code quality/security/privacy/process lifecycle, especially lexical preservation, digest
canonicalization, report custody, and singleton-validator proof.

Both reviewers receive the Stable Boundary Packet and the approved design independently.

#### Step 5: Repair findings and rerun gates

Do not close Phase A until both reviews pass current exact bytes.

#### Step 6: Commit final Phase A closure if needed

Use a scoped Conventional Commit. Do not push unless requested.

#### Step 7: Update task state

- Mark Phase A implementation complete.
- Record the model gate as passed, failed, or blocked.
- Create a separate Phase B implementation plan only when a model passed every gate and the user
  approves production wiring.
