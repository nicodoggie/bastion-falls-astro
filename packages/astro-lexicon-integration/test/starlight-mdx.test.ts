import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

describe("writeStarlightLexiconMdxPages", () => {
  it("writes a single canonical lexicon page and prunes legacy generated routes", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-mdx-fields-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const contentLexiconDirRelative =
      "src/content/docs/world/languages/hickic/seneran/test/lexicon";
    const legacyDir = path.join(root, contentLexiconDirRelative);
    mkdirSync(path.join(legacyDir, "alpha"), { recursive: true });
    mkdirSync(path.join(legacyDir, "field"), { recursive: true });
    writeFileSync(path.join(legacyDir, "search.mdx"), "---\ntitle: old\n---\n");
    writeFileSync(path.join(legacyDir, "alpha", "1.mdx"), "---\ntitle: old\n---\n");
    writeFileSync(path.join(legacyDir, "field", "basic-terms.mdx"), "---\ntitle: old\n---\n");

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
    const canonicalPage = `${lexAbs}.mdx`;

    expect(result.filesWritten).toBe(1);
    expect(existsSync(canonicalPage)).toBe(true);
    expect(existsSync(lexAbs)).toBe(false);

    const lexiconMdx = readFileSync(canonicalPage, "utf8");
    expect(lexiconMdx).toContain("import LexiconSearchWorkbench");
    expect(lexiconMdx).toContain("search-index.json");
    expect(lexiconMdx).toContain(
      'lexiconUrl="/world/languages/hickic/seneran/test/lexicon"',
    );
    expect(lexiconMdx).not.toContain("LexiconAlphaPage");
    expect(lexiconMdx).not.toContain("LexiconFieldPage");
  });
});
