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
  assert.deepEqual(plan.reconciliation, { kind: "legacy" });

});

test("selects only the reconciled then corrected legacy transcript candidates", () => {
  const plan = buildArchivePlan({
    sessionDir: "/t/session1",
    transcribeDir: "/t",
    outputDir: "/out",
    audioExtension: "opus",
  });

  assert.deepEqual(plan.legacyTranscriptCandidates, [
    "/t/session1/reconciled_transcript.md",
    "/t/session1/corrected_transcript.md",
  ]);
});

test("marks canonical reconciliation as a structured private source", () => {
  const plan = buildArchivePlan({
    sessionDir: "/t/session1",
    transcribeDir: "/t",
    outputDir: "/out",
    audioExtension: "opus",
    hasCanonicalReconciliation: true,
  });
  assert.deepEqual(plan.reconciliation, {
    kind: "canonical",
    directory: "/t/session1/reconciliation",
  });
  assert.deepEqual(plan.legacyTranscriptCandidates, []);
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
