import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGlossPairsFromLines,
  normalizeGlossPairs,
} from "./gloss.ts";

describe("interlinear gloss utilities", () => {
  it("pairs source and gloss spans from shorthand lines", () => {
    const pairs = createGlossPairsFromLines(
      "barak'er-es 'aterimris",
      "walk-ACTION-MAIN after",
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
          gloss: "walk-ACTION-MAIN",
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
      { source: "-'er", gloss: "ACTION", type: "suffix" },
    ]);

    assert.deepEqual(
      pairs.map((pair) => [pair.id, pair.source, pair.gloss, pair.type]),
      [
        ["g1", "ka-", "ADJ", "prefix"],
        ["g2", "kras", "bitter", "word"],
        ["g3", "='u", "cry", "clitic"],
        ["g4", "-'er", "ACTION", "suffix"],
      ],
    );
  });

  it("rejects shorthand lines with mismatched token counts", () => {
    assert.throws(
      () => createGlossPairsFromLines("barak'er-es 'aterimris", "walk-ACTION"),
      /same number of tokens/,
    );
  });
});
