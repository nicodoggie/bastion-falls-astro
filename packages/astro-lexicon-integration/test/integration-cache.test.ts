import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeLexiconInputFingerprint } from "../src/fingerprint.js";
import { starlightLexiconMdxNeedsWrite } from "../src/integration.js";

describe("starlightLexiconMdxNeedsWrite", () => {
  it("requires a write when the generated search page is missing", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-mdx-cache-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const contentLexiconDirRelative =
      "src/content/docs/world/languages/hickic/seneran/test/lexicon";
    const alphaDir = path.join(root, contentLexiconDirRelative, "alpha");
    mkdirSync(alphaDir, { recursive: true });
    writeFileSync(path.join(alphaDir, "1.mdx"), "---\ntitle: old\n---\n");

    expect(
      starlightLexiconMdxNeedsWrite(root, contentLexiconDirRelative),
    ).toBe(true);
  });
});

describe("computeLexiconInputFingerprint", () => {
  it("changes when the audio manifest content changes", () => {
    const root = mkdirSync(
      path.join(os.tmpdir(), `lex-audio-cache-${Date.now()}-${Math.random()}`),
      { recursive: true },
    );
    const lexDir = path.join(root, "lex");
    const audioDir = path.join(root, "audio");
    mkdirSync(lexDir, { recursive: true });
    mkdirSync(audioDir, { recursive: true });
    const shardPath = path.join(lexDir, "a.jsonld");
    const manifestPath = path.join(audioDir, "tts-lexicon-manifest.json");
    writeFileSync(shardPath, "{}\n");
    writeFileSync(manifestPath, '{"items":[]}\n');

    const first = computeLexiconInputFingerprint({
      astroRoot: root,
      shardPaths: [shardPath],
      localeId: "test",
      title: "Test",
      pageSize: 50,
      outputDirRelative: "out",
      audioManifestPathRelative: "audio/tts-lexicon-manifest.json",
      audioPublicBaseUrl: "/audio",
    });

    writeFileSync(manifestPath, '{"items":[{"id":"ehk:foo"}]}\n');

    const second = computeLexiconInputFingerprint({
      astroRoot: root,
      shardPaths: [shardPath],
      localeId: "test",
      title: "Test",
      pageSize: 50,
      outputDirRelative: "out",
      audioManifestPathRelative: "audio/tts-lexicon-manifest.json",
      audioPublicBaseUrl: "/audio",
    });

    expect(second).not.toBe(first);
  });
});
