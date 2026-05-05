import { describe, expect, it } from "vitest";

import { derivePublicLexiconBase } from "../src/starlight-mdx.js";

describe("derivePublicLexiconBase", () => {
  it("maps src/content/docs prefix to site path", () => {
    expect(
      derivePublicLexiconBase(
        "src/content/docs/world/languages/hickic/seneran/early-hick/lexicon",
      ),
    ).toBe("/world/languages/hickic/seneran/early-hick/lexicon");
  });

  it("rejects paths outside content/docs", () => {
    expect(() => derivePublicLexiconBase("src/foo/lexicon")).toThrow();
  });
});
