import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_AUDIO_BITRATE,
  DEFAULT_OUTPUT_DIRNAME,
  DEFAULT_TRANSCRIBE_DIRNAME,
  resolveArchiveSettings,
} from "./settings.js";

test("applies defaults relative to the base dir when config is empty", () => {
  const settings = resolveArchiveSettings("/repo/astro", {});
  assert.equal(
    settings.transcribeDir,
    `/repo/astro/${DEFAULT_TRANSCRIBE_DIRNAME}`,
  );
  assert.equal(settings.outputDir, `/repo/astro/${DEFAULT_OUTPUT_DIRNAME}`);
  assert.equal(settings.compression, true);
  assert.equal(settings.audioBitrate, DEFAULT_AUDIO_BITRATE);
});

test("resolves relative config paths against the base dir", () => {
  const settings = resolveArchiveSettings("/repo/astro", {
    transcribeDir: "transcripts",
    outputDir: "../archives",
    compression: false,
    audioBitrate: "24k",
  });
  assert.equal(settings.transcribeDir, "/repo/astro/transcripts");
  assert.equal(settings.outputDir, "/repo/archives");
  assert.equal(settings.compression, false);
  assert.equal(settings.audioBitrate, "24k");
});

test("keeps absolute config paths and lets overrides win", () => {
  const settings = resolveArchiveSettings(
    "/repo/astro",
    {
      transcribeDir: "/data/t",
      outputDir: "/data/out",
      compression: true,
      audioBitrate: "48k",
    },
    { compression: false, outputDir: "/tmp/out", bitrate: "16k" },
  );
  assert.equal(settings.transcribeDir, "/data/t");
  assert.equal(settings.outputDir, "/tmp/out");
  assert.equal(settings.compression, false);
  assert.equal(settings.audioBitrate, "16k");
});
