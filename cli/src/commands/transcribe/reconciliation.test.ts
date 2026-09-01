import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveReconciliationStatus,
  parseCanonicalReconciliation,
  parseReconciliationResponse,
  validateReconciliation,
  type SourceEvent,
  type ValidationContext,
} from "./reconciliation.js";

const source = (id: string, text: string, start: number, end: number): SourceEvent => ({ id, text, start, end, confidence: 0.9 });
const authoritative: SourceEvent[] = [source("e1", "Hello", 10, 12), source("e2", "world", 12, 15)];
const context: ValidationContext = { authoritativeSourceEvents: authoritative };

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "reconciliation.v1", promptVersion: "prompt.v1",
    chunk: { id: "chunk-000", start: 10, end: 20 },
    cacheIdentity: { inputHash: "input", contextHash: "context" },
    blocks: [{ id: "b1", start: 10, end: 15, kind: "dialogue", text: "Hello world.", summarySafeText: "Hello world.",
      characterCandidate: "Andrew", characterConfidence: "probable", attributionBasis: ["dialogue-context"],
      sourceEventIds: ["e1", "e2"], reviewFlags: [] }],
    omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [],
    summarySafety: { status: "valid", errors: [] }, ...overrides,
  };
}
const valid = (value: unknown, ctx = context) => validateReconciliation(value, ctx);

test("strict valid response parses with independently supplied evidence", () => {
  const parsed = parseReconciliationResponse(fixture());
  assert.equal(parsed.blocks[0]!.id, "b1");
  assert.equal(valid(parsed).status, "valid");
  assert.equal(parseCanonicalReconciliation(parsed, context).schemaVersion, "reconciliation.v1");
});

test("duration-bounded reconciliation accepts more than 2048 authoritative events", () => {
  const many = Array.from({ length: 2_049 }, (_, index) => source(`e${index}`, `event ${index}`, 0, 1));
  const response = fixture({
    chunk: { id: "chunk-many", start: 0, end: 2 },
    blocks: [{ ...fixture().blocks[0], id: "many", start: 0, end: 1, sourceEventIds: many.map((event) => event.id) }],
  });
  assert.equal(validateReconciliation(response, { authoritativeSourceEvents: many }).status, "valid");
});

test("strict schema rejects unknown keys and duplicated top-level tiers", () => {
  assert.throws(() => parseReconciliationResponse({ ...fixture(), unexpected: true }));
  assert.throws(() => parseReconciliationResponse({ ...fixture(), readableText: "duplicate" }));
  assert.throws(() => parseReconciliationResponse({ ...fixture(), summarySafeText: "duplicate" }));
});

test("authoritative universe rejects omitted, invented, and neighboring events", () => {
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], sourceEventIds: ["e1"] }] })));
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], sourceEventIds: ["e1", "neighbor"] }] })));
  assert.throws(() => valid({ ...fixture(), omissions: [{ sourceEventId: "neighbor", text: "x", start: 15, end: 16, reason: "outside-logical-window" }] }));
});

test("hard validation covers IDs, readable block, snapshots, and closed reasons", () => {
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], id: "b1" }, { ...fixture().blocks[0], id: "b1" }] })));
  assert.throws(() => valid(fixture({ blocks: [] })));
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], text: " " }] })));
  assert.throws(() => valid(fixture({ omissions: [{ sourceEventId: "e1", text: "wrong", start: 10, end: 12, reason: "decoder-loop" }] })));
  assert.throws(() => valid(fixture({ omissions: [{ sourceEventId: "e1", text: "Hello", start: 10, end: 12, reason: "invented" }] })));
});

test("claimed-event-local ranges reject unsupported interior and outer extensions, overlap remains valid", () => {
  const overlapContext: ValidationContext = { authoritativeSourceEvents: [source("e1", "Hello", 10, 13), source("e2", "world", 12, 15)] };
  const overlap = fixture({ blocks: [
    { ...fixture().blocks[0], id: "b1", start: 10, end: 13, sourceEventIds: ["e1"] },
    { ...fixture().blocks[0], id: "b2", start: 12, end: 15, sourceEventIds: ["e2"] },
  ] });
  assert.equal(valid(overlap, overlapContext).status, "valid");
  const floatingContext: ValidationContext = { authoritativeSourceEvents: [source("e1", "Hello", 10, 12), source("e2", "world", 12, 15.0000000000001)] };
  assert.equal(valid(fixture(), floatingContext).status, "valid");
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], start: 11 }] })));
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], end: 16 }] })));
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], id: "b1", start: 10, end: 12, sourceEventIds: ["e1"] }, { ...fixture().blocks[0], id: "b2", start: 9, end: 15, sourceEventIds: ["e2"] }] })));
});

test("boundary-crossing events retain original omission time while blocks use clipped support", () => {
  const crossing = {
    ...source("e1", "Hello", 9, 12),
    supportedRange: { start: 10, end: 12 },
  } as SourceEvent;
  const crossingContext: ValidationContext = {
    authoritativeSourceEvents: [crossing, source("e2", "world", 12, 15)],
  };

  assert.equal(valid(fixture(), crossingContext).status, "valid");
  assert.equal(valid(fixture({
    blocks: [{ ...fixture().blocks[0], start: 12, sourceEventIds: ["e2"] }],
    omissions: [{ sourceEventId: "e1", text: "Hello", start: 9, end: 12, reason: "false-start" }],
  }), crossingContext).status, "valid");
});

test("attribution confidence is explicit, bounded, and unknown does not fabricate a candidate", () => {
  assert.equal(valid(fixture({ blocks: [{ ...fixture().blocks[0], characterCandidate: undefined, characterConfidence: "unknown" }] })).status, "valid");
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], characterCandidate: undefined, characterConfidence: "confirmed" }] })));
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], characterCandidate: "Andrew", characterConfidence: "unknown" }] })));
  assert.throws(() => valid(fixture({ blocks: [{ ...fixture().blocks[0], attributionBasis: [] }] })));
});

test("block review flags and suspicion flags derive needs_review", () => {
  assert.equal(valid(fixture({ blocks: [{ ...fixture().blocks[0], reviewFlags: ["ambiguous-speaker"] }] })).status, "needs_review");
  assert.equal(valid(fixture({ suspicionFlags: ["reordered-source-events"] })).status, "needs_review");
});

test("material corrections preserve the authoritative source form and require evidence", () => {
  assert.equal(valid(fixture({ materialCorrections: [{ sourceEventId: "e1", sourceForm: "Hello", replacement: "Hullo", evidence: ["glossary:x"] }] })).status, "valid");
  assert.throws(() => valid(fixture({ materialCorrections: [{ sourceEventId: "e1", sourceForm: "fabricated", replacement: "Hullo", evidence: ["glossary:x"] }] })));
  assert.throws(() => valid(fixture({ materialCorrections: [{ sourceEventId: "e1", sourceForm: "Hello", replacement: "Hullo", evidence: [] }] })));
});

test("invalid safe text or recorded safety errors remain pending per block", () => {
  const pending = valid(fixture({ blocks: [{ ...fixture().blocks[0], summarySafeText: "" }], summarySafety: { status: "valid", errors: [] } }));
  assert.equal(pending.status, "valid");
  assert.equal(pending.summarySafety.status, "pending");
  assert.equal(deriveReconciliationStatus(pending, context).summarySafety.status, "pending");

  const contradictory = valid(fixture({ summarySafety: { status: "valid", errors: ["unsafe wording"] } }));
  assert.equal(contradictory.summarySafety.status, "pending");
  assert.deepEqual(contradictory.summarySafety.errors, ["unsafe wording"]);
});

test("canonical invalid artifacts are not reusable", () => {
  assert.throws(() => parseCanonicalReconciliation({ ...fixture(), status: "invalid" }, context));
});

test("model-controlled fields are bounded and validation errors do not echo identifiers", () => {
  assert.throws(() => parseReconciliationResponse(fixture({
    blocks: [{ ...fixture().blocks[0], id: "x".repeat(161) }],
  })));
  assert.throws(() => parseReconciliationResponse(fixture({
    blocks: [{ ...fixture().blocks[0], text: "x".repeat(20_001) }],
  })));
  assert.equal(parseReconciliationResponse(fixture({ reviewNotes: ["x".repeat(256)] })).reviewNotes[0]!.length, 256);
  assert.throws(() => parseReconciliationResponse(fixture({ reviewNotes: ["x".repeat(257)] })));

  const sensitiveId = "sensitive-private-marker";
  assert.throws(
    () => valid(fixture({
      blocks: [{ ...fixture().blocks[0], id: sensitiveId, start: 9 }],
    })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, new RegExp(sensitiveId, "u"));
      return true;
    },
  );
});
