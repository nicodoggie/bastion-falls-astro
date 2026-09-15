import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSummaryCleanupPrompt,
  classifySummaryRefusal,
  validateSummaryCleanup,
} from "./reconciliationSummaryCleanup.js";

test("classifies plain and empty structured refusals, not schema errors", () => {
  assert.equal(
    classifySummaryRefusal("I can't help with that content").eligible,
    true,
  );
  assert.equal(
    classifySummaryRefusal(
      "I can reconcile the campaign events and provenance, but cannot reproduce sexualized details involving children.",
    ).eligible,
    true,
  );
  assert.equal(
    classifySummaryRefusal({
      claims: [],
      sections: [],
      openHooks: [],
      confirmationsNeeded: [],
      boundaries: [],
    }).eligible,
    false,
  );
  assert.equal(
    classifySummaryRefusal({
      claims: [],
      sections: [],
      openHooks: [],
      boundaries: [
        "I can’t reproduce that content. I can provide a non-graphic account instead.",
      ],
    }).eligible,
    true,
  );
  assert.equal(
    classifySummaryRefusal("I cannot open the gate, says the guard.").eligible,
    false,
  );
  assert.equal(
    classifySummaryRefusal(
      '"I cannot reproduce sexualized details involving children," said the guard.',
    ).eligible,
    false,
  );
  assert.equal(
    classifySummaryRefusal({
      claims: [],
      sections: [],
      openHooks: [],
      boundaries: ["The council cannot change its policy."],
    }).eligible,
    false,
  );
  assert.equal(
    classifySummaryRefusal({ claims: [{ text: "A real event" }] }).eligible,
    false,
  );
  assert.equal(
    classifySummaryRefusal({
      claims: [{ text: "The policy cannot be changed by the council." }],
    }).eligible,
    false,
  );
  assert.equal(
    classifySummaryRefusal({ claims: [], sections: [] }).eligible,
    false,
  );
});

test("cleanup preserves structure, IDs, order, and provenance while allowing text edits", () => {
  const source = {
    blocks: [
      {
        id: "b0",
        text: "graphic source",
        summarySafeText: "",
        sourceEventIds: ["e0"],
      },
      {
        id: "b1",
        text: "Another event",
        summarySafeText: "safe",
        sourceEventIds: ["e1"],
      },
    ],
    claims: [
      { id: "c0", text: "A consequence", reconciliationBlockIds: ["b0"] },
    ],
  };
  const cleaned = {
    blocks: [
      {
        id: "b0",
        text: "The conflict causes a serious injury.",
        summarySafeText: "The conflict causes a serious injury.",
        sourceEventIds: ["e0"],
      },
      {
        id: "b1",
        text: "Another event",
        summarySafeText: "safe",
        sourceEventIds: ["e1"],
      },
    ],
    claims: [
      {
        id: "c0",
        text: "The consequence remains significant.",
        reconciliationBlockIds: ["b0"],
      },
    ],
  };
  assert.deepEqual(validateSummaryCleanup(source, cleaned), cleaned);
  assert.throws(
    () =>
      validateSummaryCleanup(source, {
        ...cleaned,
        blocks: [cleaned.blocks[1], cleaned.blocks[0]],
      }),
    /structure|order/iu,
  );
  assert.throws(
    () => validateSummaryCleanup(source, { ...cleaned, claims: [] }),
    /structure|compression/iu,
  );
});

test("cleanup prompt requests abstraction rather than policy bypass", () => {
  const prompt = buildSummaryCleanupPrompt("chunk", {
    blocks: [{ id: "b0", text: "source", summarySafeText: "" }],
  });
  assert.match(prompt, /non-graphic contextual abstraction/iu);
  assert.match(prompt, /Do not bypass provider policy/iu);
  assert.match(prompt, /Return JSON only/iu);
});

test("gross compression guard counts editable text inside nested record containers", () => {
  const source = {
    claims: [
      {
        id: "c0",
        text: "A detailed event with consequences and context. ".repeat(10),
      },
    ],
  };
  const candidate = { claims: [{ id: "c0", text: "Too short." }] };
  assert.throws(
    () => validateSummaryCleanup(source, candidate),
    /gross narrative compression/iu,
  );
});
