import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateLexiconSite } from "../src/generate-site.js";

const minimalDoc = {
  "@graph": [
    {
      "@id": "ehk:foo",
      "@type": ["ontolex:LexicalEntry", "lexinfo:Noun"],
      canonicalForm: { writtenRep: "foo", phoneticRep: "foo" },
      sense: [
        {
          definition: { "@value": "bar", "@language": "en" },
          "lexinfo:semanticField": "Basic Terms",
        },
      ],
    },
  ],
};

describe("generateLexiconSite skip-if-unchanged", () => {
  it("skips compile when fingerprint matches stamp", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-skip-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const lexDir = path.join(root, "lex");
    mkdirSync(lexDir, { recursive: true });
    const shard = path.join(lexDir, "a.jsonld");
    writeFileSync(shard, JSON.stringify(minimalDoc));

    const outRel = "out/lex";
    const opts = {
      astroRoot: root,
      shardPaths: [shard],
      outputDirRelative: outRel,
      localeId: "test",
      title: "Test Lex",
      pageSize: 50,
    };

    const first = generateLexiconSite(opts);
    expect(first.skipped).toBe(false);
    expect(first.manifest.alpha.entryCount).toBe(1);

    const second = generateLexiconSite(opts);
    expect(second.skipped).toBe(true);
    expect(second.manifest.alpha.entryCount).toBe(1);
  });

  it("recompiles when shard file changes on disk", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-chg-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const lexDir = path.join(root, "lex");
    mkdirSync(lexDir, { recursive: true });
    const shard = path.join(lexDir, "a.jsonld");
    writeFileSync(shard, JSON.stringify(minimalDoc));

    const outRel = "out/lex2";
    const opts = {
      astroRoot: root,
      shardPaths: [shard],
      outputDirRelative: outRel,
      localeId: "test",
      title: "Test Lex",
      pageSize: 50,
    };

    expect(generateLexiconSite(opts).skipped).toBe(false);

    const changed = structuredClone(minimalDoc) as typeof minimalDoc;
    (changed["@graph"][0] as { canonicalForm: { writtenRep: string } }).canonicalForm.writtenRep =
      "foox";
    writeFileSync(shard, JSON.stringify(changed));

    expect(generateLexiconSite(opts).skipped).toBe(false);
  });
});
