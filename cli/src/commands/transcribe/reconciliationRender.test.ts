import test from "node:test";
import assert from "node:assert/strict";
import { renderPrivateReconciliation, renderSummaryReconciliation, renderReconciliationReviewQueue, renderPublicReconciliation } from "./reconciliationRender.js";
import type { CanonicalReconciliation } from "./reconciliation.js";

const chunk = { schemaVersion: "reconciliation.v1", promptVersion: "p", chunk: { id: "session_000", start: 0, end: 10 }, cacheIdentity: { inputHash: "i", contextHash: "c" }, blocks: [
  { id: "b1", start: 1, end: 3, kind: "dialogue" as const, text: "Hello readable", summarySafeText: "Hello safe", channel: "left", physicalSpeaker: "Private Person", characterCandidate: "Andrew", characterConfidence: "confirmed" as const, attributionBasis: ["explicit"], sourceEventIds: ["session_000:event_0000"], reviewFlags: ["material-correction" as const] },
  { id: "b2", start: 2, end: 4, kind: "narration" as const, text: "Narration", summarySafeText: "Narration safe", characterConfidence: "unknown" as const, attributionBasis: ["narration"], sourceEventIds: ["session_000:event_0001"], reviewFlags: [] },
  { id: "b3", start: 5, end: 6, kind: "dialogue" as const, text: "Probable words", summarySafeText: "Probable safe", characterCandidate: "Yomi", characterConfidence: "probable" as const, attributionBasis: ["channel"], sourceEventIds: ["session_000:event_0003"], reviewFlags: [] },
  { id: "b4", start: 7, end: 8, kind: "dialogue" as const, text: "Unknown words", summarySafeText: "Unknown safe", characterConfidence: "unknown" as const, attributionBasis: ["unclear"], sourceEventIds: ["session_000:event_0004"], reviewFlags: [] },
], omissions: [{ sourceEventId: "session_000:event_0002", text: "loop", start: 4, end: 5, reason: "decoder-loop" as const }], materialCorrections: [{ sourceEventId: "session_000:event_0000", sourceForm: "Hello", replacement: "Hello", evidence: ["rule"] }], suspicionFlags: ["large-compression" as const], reviewNotes: ["check"], summarySafety: { status: "valid" as const, errors: [] }, status: "needs_review" as const } as CanonicalReconciliation;

test("private and summary render deterministically and preserve overlap/provenance", () => {
  const privateText = renderPrivateReconciliation([chunk]);
  assert.match(privateText, /\[channel:left\].*\[speaker:Private Person\]/);
  assert.match(privateText, /b1.*session_000:event_0000/);
  assert.match(privateText, /\[00:00:02 - 00:00:04\]/);
  const summary = renderSummaryReconciliation([chunk]);
  assert.match(summary, /Hello safe/); assert.doesNotMatch(summary, /Hello readable/);
  assert.match(summary, /b1/); assert.match(summary, /large-compression/);
  assert.equal(privateText.endsWith("\n"), true); assert.equal(privateText.endsWith("\n\n"), false);
  const later = { ...chunk, chunk: { ...chunk.chunk, id: "session_001" }, blocks: [{ ...chunk.blocks[0]!, id: "later" }] };
  const ordered = renderPrivateReconciliation([later, chunk]);
  assert.ok(ordered.indexOf("b1") < ordered.indexOf("later"));
  const shuffledBlocks = renderPrivateReconciliation([{ ...chunk, blocks: [...chunk.blocks].reverse() }]);
  assert.ok(shuffledBlocks.indexOf("b1") < shuffledBlocks.indexOf("b4"));
});

test("summary pending fails and review queue retains reasons", () => {
  assert.throws(() => renderSummaryReconciliation([{ ...chunk, summarySafety: { status: "pending", errors: ["bad"] } }]), /summary/i);
  const review = renderReconciliationReviewQueue([chunk]);
  assert.match(review, /b1|material-correction|large-compression|decoder-loop|check/);
  assert.match(review, /b3.*probable|b4.*unknown/si);
  assert.match(review, /session_000:event_0003|session_000:event_0004/);
  assert.match(review, /00:00:05.*Yomi.*probable|00:00:07.*unknown/si);
  assert.doesNotMatch(review, /speaker:/i);
});

test("public uses visible confidence labels once and no private structure", () => {
  const output = renderPublicReconciliation([chunk]);
  assert.match(output, /\[Andrew\] Hello readable/);
  assert.match(output, /\[GM\] Narration/);
  assert.match(output, /\[Yomi\? - probable\] Probable words/);
  assert.match(output, /\[Player \/ character unknown\] Unknown words/);
  assert.match(output, /Confidence legend/);
  assert.equal((output.match(/Confidence legend/g) ?? []).length, 1);
  assert.doesNotMatch(output, /Private Person|speaker:|channel:|session_000:event|Hello safe/);
});

test("public rendering fails closed on private structural markers", () => {
  for (const marker of ["[speaker:Andrew] hello", "[channel:left] hello"]) {
    assert.throws(() => renderPublicReconciliation([{ ...chunk, blocks: [{ ...chunk.blocks[0]!, text: marker }] }]), /structural|private|marker/i);
    assert.throws(
      () => renderPublicReconciliation([{ ...chunk, blocks: [{ ...chunk.blocks[0]!, characterCandidate: marker }] }]),
      /structural|private|marker/i,
    );
  }

  assert.throws(
    () => renderPublicReconciliation([{
      ...chunk,
      blocks: [{
        ...chunk.blocks[0]!,
        physicalSpeaker: "Private Person",
        characterCandidate: "private person",
      }],
    }]),
    /physical|private|identity/iu,
  );
});
