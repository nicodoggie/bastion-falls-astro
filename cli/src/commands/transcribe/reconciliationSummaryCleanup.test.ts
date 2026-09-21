import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSummaryCleanupPrompt,
  classifySummaryRefusal,
  applySummaryCleanupResponse,
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

test("live cleanup edits prose without echoing metadata and stored cleanup remains strict", () => {
  const source = {
    schemaVersion: "source.v1",
    cacheIdentity: "hash",
    blocks: [{ id: "b0", text: "An event happened.", sourceEventIds: ["e0"] }],
  };
  const edits = {
    edits: [
      { path: ["blocks", "0", "text"], text: "The event had consequences." },
    ],
  };
  const cleaned = applySummaryCleanupResponse(source, edits);
  assert.deepEqual(cleaned, {
    ...source,
    blocks: [{ ...source.blocks[0], text: "The event had consequences." }],
  });
  assert.equal(source.blocks[0]!.text, "An event happened.");
  for (const path of [
    ["cacheIdentity"],
    ["blocks", "0", "id"],
    ["blocks", "9", "text"],
    ["__proto__", "text"],
  ]) {
    assert.throws(() =>
      applySummaryCleanupResponse(source, { edits: [{ path, text: "bad" }] }),
    );
  }
  assert.throws(() =>
    applySummaryCleanupResponse(source, {
      edits: [...edits.edits, ...edits.edits],
    }),
  );
  assert.throws(() => validateSummaryCleanup(source, edits));
  const group = [
    {
      claims: [{ id: "c0", text: "Narrative." }],
      sourceReviewTargets: [{ id: "r0", text: "Original review evidence." }],
    },
  ];
  assert.throws(() =>
    applySummaryCleanupResponse(group, {
      edits: [
        {
          path: ["0", "sourceReviewTargets", "0", "text"],
          text: "Changed evidence.",
        },
      ],
    }),
  );
  assert.throws(() =>
    validateSummaryCleanup(group, [
      {
        ...group[0],
        sourceReviewTargets: [{ id: "r0", text: "Changed evidence." }],
      },
    ]),
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

test("cleanup prompt preserves literal hashes in editable narrative prose", () => {
  const narrativeHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const metadataHash = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  const prompt = buildSummaryCleanupPrompt("chunk", {
    schemaVersion: "source.v1",
    cacheIdentity: metadataHash,
    blocks: [
      {
        id: metadataHash,
        text: `The inscription literally reads ${narrativeHash}.`,
        sourceEventIds: [metadataHash],
      },
    ],
    sourceReviewTargets: [{ id: metadataHash, text: "Review provenance." }],
  });
  const inputJson = prompt.match(/<input>\n([\s\S]*)\n<\/input>/u)?.[1];
  assert.ok(inputJson);
  const modelInput = JSON.parse(inputJson) as {
    cacheIdentity: string;
    blocks: [{ text: string }];
  };
  assert.equal(
    modelInput.blocks[0].text,
    `The inscription literally reads ${narrativeHash}.`,
  );
  assert.match(prompt, /local_ref_000/gu);
  assert.match(modelInput.cacheIdentity, /^local_ref_\d{3}$/u);
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
