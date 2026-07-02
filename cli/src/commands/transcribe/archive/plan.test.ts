import assert from "node:assert/strict";
import { test } from "node:test";

import { buildArchivePlan } from "./plan.js";

test("maps a session dir to audio source, entry names, and outputs", () => {
  const plan = buildArchivePlan({
    sessionDir: "/repo/astro/.bf-transcripts/session-2026-05-22",
    transcribeDir: "/repo/astro/.bf-transcripts",
    outputDir: "/repo/astro/.bf-archives",
    audioExtension: "opus",
  });

  assert.equal(plan.sessionName, "session-2026-05-22");
  assert.equal(
    plan.audioSource,
    "/repo/astro/.bf-transcripts/session-2026-05-22/normalized/session.flac",
  );
  assert.equal(plan.audioEntryName, "session-audio.opus");
  assert.equal(plan.zipPath, "/repo/astro/.bf-archives/session-2026-05-22.zip");
  assert.equal(plan.unpackedDir, "/repo/astro/.bf-archives/session-2026-05-22");
});

test("includes transcripts and shared corrections with required flags", () => {
  const plan = buildArchivePlan({
    sessionDir: "/t/session1",
    transcribeDir: "/t",
    outputDir: "/out",
    audioExtension: "opus",
  });

  assert.deepEqual(plan.copies, [
    {
      sourcePath: "/t/session1/raw_transcript.md",
      entryName: "raw_transcript.md",
      required: true,
    },
    {
      sourcePath: "/t/session1/corrected_transcript.md",
      entryName: "corrected_transcript.md",
      required: false,
    },
    {
      sourcePath: "/t/corrections.yaml",
      entryName: "corrections.yaml",
      required: false,
    },
  ]);
});

test("honors a non-opus audio extension", () => {
  const plan = buildArchivePlan({
    sessionDir: "/t/s",
    transcribeDir: "/t",
    outputDir: "/out",
    audioExtension: "ogg",
  });
  assert.equal(plan.audioEntryName, "session-audio.ogg");
});
