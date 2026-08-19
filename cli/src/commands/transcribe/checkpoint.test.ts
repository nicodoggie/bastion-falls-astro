import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  getCheckpointPath,
  parseTranscribeCheckpoint,
  readTranscribeCheckpoint,
  writeTranscribeCheckpoint,
  type TranscribeCheckpointV2,
  type TranscribeCheckpointV3,
} from "./checkpoint.js";

function sampleV2(): TranscribeCheckpointV2 {
  const now = "2026-05-20T14:46:17.134Z";
  return {
    version: 2,
    updatedAt: now,
    source: "/home/ensu/session1.flac",
    outDir: "astro/.bf-transcripts/session1",
    sessionDate: "2026-05-16",
    campaign: "the-vengeful",
    profile: "legacy-local",
    layout: "stereo",
    stages: {
      normalization: { status: "complete", completedAt: now, path: "astro/.bf-transcripts/session1/normalized/session.flac" },
      audio_chunking: { status: "complete", completedAt: now, count: 2, dir: "astro/.bf-transcripts/session1/chunks", requiredPasses: ["stereo"], availableByPass: { stereo: [0, 1] } },
      transcribed_chunks: { status: "complete", completedAt: now, requiredPasses: ["stereo"], completedByPass: { stereo: [0, 1] }, selection: [0, 1], total: 2, rawChunksDir: "astro/.bf-transcripts/session1/raw_chunks", rawTranscriptionDir: "astro/.bf-transcripts/session1/raw_transcription" },
      joining_raw_transcription: { status: "complete", completedAt: now, path: "astro/.bf-transcripts/session1/raw_transcript.md" },
      correction_pass: { status: "complete", completedAt: now, correctedTranscriptPath: "astro/.bf-transcripts/session1/corrected_transcript.md", correctionNotesPath: "astro/.bf-transcripts/session1/correction_notes.md", reviewProvider: "hermes", reconciledTranscriptPath: "astro/.bf-transcripts/session1/reconciled_transcript.md", hermesReviewNotesPath: "astro/.bf-transcripts/session1/hermes_review_notes.md", finalTranscriptPath: "astro/.bf-transcripts/session1/reconciled_transcript.md", finalCorrectionNotesPath: "astro/.bf-transcripts/session1/hermes_review_notes.md" },
      notes_summary_pass: { status: "complete", completedAt: now, notesPath: "astro/src/content/docs/world/notes/the-vengeful/2026-05-16.mdx" },
      done: { status: "complete", completedAt: now },
    },
  };
}

function sampleV3(): TranscribeCheckpointV3 {
  const migrated = parseTranscribeCheckpoint(sampleV2());
  migrated.stages.reconciliation = {
    status: "complete",
    completedAt: migrated.updatedAt,
    metadata: {
      provider: "hermes",
      mode: "enabled",
      reconciliationDir: "astro/.bf-transcripts/session1/reconciliation",
      reconciledTranscriptPath: "astro/.bf-transcripts/session1/reconciled_transcript.md",
      summaryTranscriptPath: "astro/.bf-transcripts/session1/summary_transcript.md",
      reviewQueuePath: "astro/.bf-transcripts/session1/reconciliation_review_queue.md",
      schemaVersion: "reconciliation.v1",
      promptVersion: "reconciliation.prompt.v1",
      cacheIdentityByChunk: { session_000: "a".repeat(64), session_001: "b".repeat(64) },
      completedChunkIds: ["session_000", "session_001"],
      status: "needs_review",
      summarySafety: { pendingChunkIds: [], bypassChunkIds: [] },
    },
  };
  return parseTranscribeCheckpoint(migrated);
}

test("parses strict v3 reconciliation metadata", () => {
  const checkpoint = sampleV3();
  assert.deepEqual(parseTranscribeCheckpoint(checkpoint), checkpoint);
  assert.equal(checkpoint.stages.reconciliation.metadata.provider, "hermes");
  assert.equal(checkpoint.stages.reconciliation.metadata.status, "needs_review");
});

test("migrates v2 explicitly and preserves historical correction metadata", () => {
  const legacy = sampleV2();
  const migrated = parseTranscribeCheckpoint(legacy);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.stages.reconciliation.metadata.provider, "legacy");
  assert.equal(migrated.stages.reconciliation.metadata.mode, "legacy");
  assert.deepEqual(migrated.stages.reconciliation.compatibility?.correctionPass, legacy.stages.correction_pass);
  assert.equal("correction_pass" in migrated.stages, false);

  const disabled = structuredClone(legacy);
  disabled.stages.correction_pass.status = "skipped";
  disabled.stages.correction_pass.reviewProvider = "off";
  disabled.stages.done.status = "pending";
  const migratedDisabled = parseTranscribeCheckpoint(disabled);
  assert.equal(migratedDisabled.stages.reconciliation.status, "skipped");
  assert.equal(migratedDisabled.stages.reconciliation.metadata.provider, "off");

  const failed = structuredClone(legacy);
  failed.stages.correction_pass.status = "failed";
  failed.stages.correction_pass.startedAt = legacy.updatedAt;
  failed.stages.correction_pass.completedAt = legacy.updatedAt;
  failed.stages.correction_pass.error = "historical failure";
  failed.stages.notes_summary_pass.status = "pending";
  failed.stages.notes_summary_pass.completedAt = undefined;
  failed.stages.done.status = "pending";
  failed.stages.done.completedAt = undefined;
  const migratedFailed = parseTranscribeCheckpoint(failed);
  assert.equal(migratedFailed.stages.reconciliation.status, "failed");
  assert.equal(migratedFailed.stages.reconciliation.startedAt, legacy.updatedAt);
  assert.equal(migratedFailed.stages.reconciliation.completedAt, undefined);
  assert.equal(migratedFailed.stages.reconciliation.error, "historical failure");
});

test("rejects incompatible reconciliation metadata as one boundary matrix", () => {
  const mutations: Array<[string, (value: TranscribeCheckpointV3) => void]> = [
    ["unsafe path", (value) => { value.stages.reconciliation.metadata.reconciliationDir = "../escape"; }],
    ["invalid chunk", (value) => { value.stages.reconciliation.metadata.completedChunkIds = ["chunk_000"]; value.stages.reconciliation.metadata.cacheIdentityByChunk = { chunk_000: "x" }; }],
    ["missing cache identity", (value) => { value.stages.reconciliation.metadata.cacheIdentityByChunk = { session_000: "x" }; }],
    ["pending bypass overlap", (value) => { value.stages.reconciliation.metadata.status = "pending"; value.stages.reconciliation.metadata.summarySafety = { pendingChunkIds: ["session_000"], bypassChunkIds: ["session_000"] }; }],
    ["invalid complete status", (value) => { value.stages.reconciliation.metadata.status = "invalid"; }],
  ];
  for (const [name, mutate] of mutations) {
    const value = sampleV3();
    mutate(value);
    assert.throws(() => parseTranscribeCheckpoint(value), name);
  }
  assert.throws(() => parseTranscribeCheckpoint({ ...sampleV3(), version: 99 }), /version|literal|option/i);
});

test("done requires truthful terminal reconciliation and notes", () => {
  const valid = sampleV3();
  assert.equal(parseTranscribeCheckpoint(valid).stages.done.status, "complete");

  const pending = sampleV3();
  pending.stages.reconciliation.status = "pending";
  pending.stages.reconciliation.completedAt = undefined;
  pending.stages.reconciliation.metadata.status = "pending";
  assert.throws(() => parseTranscribeCheckpoint(pending), /done requires truthful terminal stages/i);
});

test("retains pass manifest and bounded selection validation", () => {
  const inconsistent = sampleV3();
  inconsistent.stages.transcribed_chunks.selection = [2];
  assert.throws(() => parseTranscribeCheckpoint(inconsistent), /selection|manifest/i);

  const malformed = sampleV3();
  malformed.stages.transcribed_chunks.completedByPass["stereo"] = [0, -1];
  assert.throws(() => parseTranscribeCheckpoint(malformed), />=0|nonnegative/i);
});

test("writes only v3 checkpoint files atomically and reads them back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-checkpoint-test-"));
  try {
    const path = getCheckpointPath(dir);
    const expected = sampleV3();
    await writeTranscribeCheckpoint(path, expected);
    const original = await readFile(path, "utf8");
    await assert.rejects(
      () => writeTranscribeCheckpoint(path, { ...expected, campaign: "replacement" }, { beforeRename: () => { throw new Error("before rename"); } }),
      /before rename/iu,
    );
    assert.equal(await readFile(path, "utf8"), original);
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
    assert.deepEqual(await readTranscribeCheckpoint(path), expected);
    const disk = JSON.parse(await readFile(path, "utf8"));
    assert.equal(disk.version, 3);
    assert.equal("correction_pass" in disk.stages, false);
    assert.equal(await readFile(`${path}.tmp`, "utf8").catch(() => undefined), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns undefined for missing checkpoint and rejects corrupt JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-checkpoint-test-"));
  try {
    const path = getCheckpointPath(dir);
    assert.equal(await readTranscribeCheckpoint(path), undefined);
    await writeFile(path, "{not json", "utf8");
    await assert.rejects(() => readTranscribeCheckpoint(path), SyntaxError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
