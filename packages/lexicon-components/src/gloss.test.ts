import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGlossPairsFromLines,
  normalizeGlossPairs,
} from "./gloss";

describe("interlinear gloss utilities", () => {
  it("pairs source and gloss spans from shorthand lines", () => {
    const pairs = createGlossPairsFromLines(
      "barak'er-es 'aterimris",
      "walk-VRB-ABS after",
    );

    assert.deepEqual(
      pairs.map((pair) => ({
        id: pair.id,
        source: pair.source,
        gloss: pair.gloss,
        type: pair.type,
      })),
      [
        {
          id: "g1",
          source: "barak'er-es",
          gloss: "walk-VRB-ABS",
          type: "word",
        },
        {
          id: "g2",
          source: "'aterimris",
          gloss: "after",
          type: "word",
        },
      ],
    );
  });

  it("keeps explicit suffix, prefix, and clitic metadata for span rendering", () => {
    const pairs = normalizeGlossPairs([
      { source: "ka-", gloss: "ADJ", type: "prefix" },
      { source: "kras", gloss: "bitter" },
      { source: "='u", gloss: "cry", type: "clitic" },
      { source: "-'er", gloss: "VRB", type: "suffix" },
    ]);

    assert.deepEqual(
      pairs.map((pair) => [pair.id, pair.source, pair.gloss, pair.type]),
      [
        ["g1", "ka-", "ADJ-", "prefix"],
        ["g2", "kras", "bitter", "word"],
        ["g3", "='u", "cry", "clitic"],
        ["g4", "-'er", "-VRB", "suffix"],
      ],
    );
  });

  it("adds affix boundary hyphens from prefix and suffix token types", () => {
    const pairs = normalizeGlossPairs([
      { source: "ma", gloss: "PL", type: "prefix" },
      { source: "vinud", gloss: "build" },
      { source: "es!", gloss: "ABS!", type: "suffix" },
      { source: "ka-", gloss: "ADJ-", type: "prefix" },
      { source: "-'er", gloss: "-VRB", type: "suffix" },
    ]);

    assert.deepEqual(
      pairs.map((pair) => [pair.id, pair.source, pair.gloss, pair.type]),
      [
        ["g1", "ma-", "PL-", "prefix"],
        ["g2", "vinud", "build", "word"],
        ["g3", "-es!", "-ABS!", "suffix"],
        ["g4", "ka-", "ADJ-", "prefix"],
        ["g5", "-'er", "-VRB", "suffix"],
      ],
    );
  });

  it("rejects shorthand lines with mismatched token counts", () => {
    assert.throws(
      () => createGlossPairsFromLines("barak'er-es 'aterimris", "walk-VRB"),
      /same number of tokens/,
    );
  });
});
