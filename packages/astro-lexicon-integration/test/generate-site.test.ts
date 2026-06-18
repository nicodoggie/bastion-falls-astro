import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

  it("writes stable semantic field chunks and route metadata", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-fields-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const lexDir = path.join(root, "lex");
    mkdirSync(lexDir, { recursive: true });
    const shard = path.join(lexDir, "a.jsonld");
    writeFileSync(shard, JSON.stringify(minimalDoc));

    const outRel = "out/lex-fields";
    const result = generateLexiconSite({
      astroRoot: root,
      shardPaths: [shard],
      outputDirRelative: outRel,
      localeId: "test",
      title: "Test Lex",
      pageSize: 50,
    });

    const outAbs = path.join(root, outRel);
    const fieldPath = path.join(outAbs, "field-basic-terms.json");

    expect(existsSync(fieldPath)).toBe(true);
    expect(result.manifest.fields.fieldCount).toBe(1);
    expect(result.manifest.fields.routes).toEqual([
      {
        label: "Basic Terms",
        uri: "basic-terms",
        itemCount: 1,
      },
    ]);

    const chunk = JSON.parse(readFileSync(fieldPath, "utf8")) as {
      fieldLabel: string;
      fieldUri: string;
      items: Array<{ writtenForm: string }>;
    };
    expect(chunk.fieldLabel).toBe("Basic Terms");
    expect(chunk.fieldUri).toBe("basic-terms");
    expect(chunk.items.map((item) => item.writtenForm)).toEqual(["foo"]);
  });

  it("writes a deterministic search index with alpha page and field metadata", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-search-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const lexDir = path.join(root, "lex");
    mkdirSync(lexDir, { recursive: true });
    const shard = path.join(lexDir, "a.jsonld");
    writeFileSync(shard, JSON.stringify(minimalDoc));

    const outRel = "out/lex-search";
    const result = generateLexiconSite({
      astroRoot: root,
      shardPaths: [shard],
      outputDirRelative: outRel,
      localeId: "test",
      title: "Test Lex",
      pageSize: 50,
    });

    const indexPath = path.join(root, outRel, "search-index.json");

    expect(existsSync(indexPath)).toBe(true);
    const searchIndex = JSON.parse(readFileSync(indexPath, "utf8")) as {
      version: number;
      localeId: string;
      title: string;
      entries: Array<{
        id: string;
        writtenForm: string;
        typeLabels: string[];
        alphaPage: number;
        fieldUris: string[];
        fieldLabels: string[];
      }>;
    };

    expect(searchIndex).toEqual({
      version: 1,
      localeId: "test",
      title: "Test Lex",
      entries: [
        {
          id: "ehk:foo",
          writtenForm: "foo",
          phoneticForm: "foo",
          types: ["ontolex:LexicalEntry", "lexinfo:Noun"],
          typeLabels: ["noun"],
          senses: [
            {
              definition: "bar",
              semanticField: ["Basic Terms"],
            },
          ],
          alphaPage: 1,
          fieldUris: ["basic-terms"],
          fieldLabels: ["Basic Terms"],
        },
      ],
    });
    expect(result.manifest.alpha.entryCount).toBe(1);
  });

  it("adds audio metadata to the search index from a TTS manifest", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-audio-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const lexDir = path.join(root, "lex");
    mkdirSync(lexDir, { recursive: true });
    const shard = path.join(lexDir, "a.jsonld");
    writeFileSync(shard, JSON.stringify(minimalDoc));

    const audioDir = path.join(root, "audio");
    mkdirSync(audioDir, { recursive: true });
    const audioManifest = path.join(audioDir, "tts-lexicon-manifest.json");
    writeFileSync(
      audioManifest,
      JSON.stringify({
        items: [
          {
            id: "ehk:foo",
            status: "generated",
            outputPath: path.join(audioDir, "foo.webm"),
            sources: [
              {
                outputPath: path.join(audioDir, "foo.webm"),
                type: "audio/webm; codecs=opus",
              },
              {
                outputPath: path.join(audioDir, "foo.mp3"),
              },
            ],
          },
        ],
      }),
    );

    generateLexiconSite({
      astroRoot: root,
      shardPaths: [shard],
      outputDirRelative: "out/lex-audio",
      localeId: "test",
      title: "Test Lex",
      pageSize: 50,
      audio: {
        manifestPathRelative: "audio/tts-lexicon-manifest.json",
        publicBaseUrl: "/assets/audio",
      },
    });

    const searchIndex = JSON.parse(
      readFileSync(path.join(root, "out/lex-audio/search-index.json"), "utf8"),
    ) as {
      entries: Array<{
        audio?: {
          sources: Array<{ url: string; type: string }>;
        };
      }>;
    };

    expect(searchIndex.entries[0]?.audio).toEqual({
      label: "Pronunciation",
      sources: [
        {
          url: "/assets/audio/foo.webm",
          type: "audio/webm; codecs=opus",
        },
        {
          url: "/assets/audio/foo.mp3",
          type: "audio/mpeg",
        },
      ],
    });
  });
});
