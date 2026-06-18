import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MANIFEST_VERSION } from "../src/manifest.js";
import {
  derivePublicLexiconBase,
  writeStarlightLexiconMdxPages,
} from "../src/starlight-mdx.js";

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

describe("writeStarlightLexiconMdxPages field routes", () => {
  it("writes a visible fields index and hidden indexable field pages", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-mdx-fields-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const contentLexiconDirRelative =
      "src/content/docs/world/languages/hickic/seneran/test/lexicon";

    const result = writeStarlightLexiconMdxPages({
      astroRoot: root,
      contentLexiconDirRelative,
      manifest: {
        version: MANIFEST_VERSION,
        localeId: "test",
        title: "Test Lex",
        pageSize: 50,
        outputDir: "src/generated/lexicon/test",
        fieldsMeta: {
          "Basic Terms": { label: "Basic Terms", uri: "basic-terms" },
        },
        fieldLabelsOrdered: ["Basic Terms"],
        alpha: { pageCount: 1, entryCount: 1 },
        byField: { pageCount: 1, rowCount: 1 },
        fields: {
          fieldCount: 1,
          routes: [
            {
              label: "Basic Terms",
              uri: "basic-terms",
              itemCount: 1,
            },
          ],
        },
      },
    });

    const lexAbs = path.join(root, contentLexiconDirRelative);
    const fieldsIndex = path.join(lexAbs, "fields.mdx");
    const fieldPage = path.join(lexAbs, "field", "basic-terms.mdx");
    const searchPage = path.join(lexAbs, "search.mdx");

    expect(result.filesWritten).toBeGreaterThanOrEqual(2);
    expect(existsSync(fieldsIndex)).toBe(true);
    expect(existsSync(fieldPage)).toBe(true);
    expect(existsSync(searchPage)).toBe(true);

    expect(readFileSync(fieldsIndex, "utf8")).toContain(
      "import LexiconFieldsIndexPage",
    );

    const fieldMdx = readFileSync(fieldPage, "utf8");
    expect(fieldMdx).toContain("sidebar:");
    expect(fieldMdx).toContain("hidden: true");
    expect(fieldMdx).toContain("pagefind: true");
    expect(fieldMdx).toContain("import LexiconFieldPage");
    expect(fieldMdx).toContain("field-basic-terms.json");

    const searchMdx = readFileSync(searchPage, "utf8");
    expect(searchMdx).toContain("import LexiconSearchWorkbench");
    expect(searchMdx).toContain("search-index.json");
    expect(searchMdx).toContain(
      'lexiconUrl="/world/languages/hickic/seneran/test/lexicon"',
    );
  });
});
