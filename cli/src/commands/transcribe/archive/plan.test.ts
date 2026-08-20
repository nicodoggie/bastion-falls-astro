import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildArchivePlan, collectArchiveSources } from "./plan.js";

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

  const sourceNames = plan.copies.map((copy) => copy.entryName);
  assert.ok(sourceNames.every((name) => !name.startsWith("normalized/")));
  assert.ok(sourceNames.every((name) => !name.startsWith("channels/")));
  assert.ok(sourceNames.every((name) => !name.startsWith("chunks/")));
});

test("collects bounded provenance trees and excludes derivatives", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "bf-archive-plan-"));
  await mkdir(join(sessionDir, "raw_transcription", "alignment"), { recursive: true });
  await mkdir(join(sessionDir, "raw_chunks", "passes", "left"), { recursive: true });
  await mkdir(join(sessionDir, "normalized", "channels"), { recursive: true });
  await writeFile(join(sessionDir, "manifest.json"), "{}");
  await writeFile(join(sessionDir, "raw_transcription", "alignment", "session_001.json"), "{}");
  await writeFile(join(sessionDir, "raw_chunks", "passes", "left", "session_001.md"), "ok");
  await writeFile(join(sessionDir, "normalized", "channels", "leak.flac"), "no");
  await writeFile(join(sessionDir, "raw_transcription", "ignore.txt"), "no");
  const outside = join(await mkdtemp(join(tmpdir(), "bf-archive-outside-")), "outside.json");
  await writeFile(outside, "secret");
  await symlink(outside, join(sessionDir, "raw_transcription", "outside.json"));

  const sources = await collectArchiveSources(sessionDir);
  assert.deepEqual(sources.map((source) => source.entryName), [
    "manifest.json",
    "raw_chunks/passes/left/session_001.md",
    "raw_transcription/alignment/session_001.json",
  ]);
  assert.ok(sources.every((source) => !source.entryName.startsWith("normalized/")));
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
      sourcePath: "/t/session1/correction_notes.md",
      entryName: "correction_notes.md",
      required: false,
    },
    {
      sourcePath: "/t/session1/reconciled_transcript.md",
      entryName: "reconciled_transcript.md",
      required: false,
    },
    {
      sourcePath: "/t/session1/hermes_review_notes.md",
      entryName: "hermes_review_notes.md",
      required: false,
    },
    {
      sourcePath: "/t/corrections.yaml",
      entryName: "corrections.yaml",
      required: false,
    },
    {
      sourcePath: "/t/session1/manifest.json",
      entryName: "manifest.json",
      required: false,
    },
    {
      sourcePath: "/t/session1/checkpoint.json",
      entryName: "checkpoint.json",
      required: false,
    },
    {
      sourcePath: "/t/session1/channel-map.yml",
      entryName: "channel-map.yml",
      required: false,
    },
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
  assert.deepEqual(plan.copies, [
    {
      sourcePath: "/t/corrections.yaml",
      entryName: "corrections.yaml",
      required: false,
    },
  ]);
  assert.ok(!plan.copies.some((copy) => copy.entryName === "summary_transcript.md"));
  assert.ok(!plan.copies.some((copy) => copy.entryName === "redactions.yaml"));
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
