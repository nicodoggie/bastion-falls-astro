import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  getCheckpointPath,
  parseTranscribeCheckpoint,
  readTranscribeCheckpoint,
  writeTranscribeCheckpoint,
  type TranscribeCheckpoint,
} from "./checkpoint.js";

function sampleCheckpoint(): TranscribeCheckpoint {
  const now = "2026-05-20T14:46:17.134Z";
  return {
    version: 1,
    updatedAt: now,
    source: "/home/ensu/session1.flac",
    outDir: "astro/.bf-transcripts/session1",
    sessionDate: "2026-05-16",
    campaign: "the-vengeful",
    stages: {
      normalization: {
        status: "complete",
        completedAt: now,
        path: "/home/ensu/Projects/bastion-falls-astro/astro/.bf-transcripts/session1/normalized/session.flac",
      },
      audio_chunking: {
        status: "complete",
        completedAt: now,
        count: 51,
        dir: "astro/.bf-transcripts/session1/chunks",
      },
      transcribed_chunks: {
        status: "pending",
        completed: [],
        total: 51,
        rawChunksDir: "astro/.bf-transcripts/session1/raw_chunks",
        rawTranscriptionDir: "astro/.bf-transcripts/session1/raw_transcription",
      },
      joining_raw_transcription: {
        status: "pending",
        path: "astro/.bf-transcripts/session1/raw_transcript.md",
      },
      correction_pass: {
        status: "pending",
        correctedTranscriptPath: "astro/.bf-transcripts/session1/corrected_transcript.md",
        correctionNotesPath: "astro/.bf-transcripts/session1/correction_notes.md",
      },
      notes_summary_pass: {
        status: "pending",
        notesPath: "astro/src/content/docs/world/notes/the-vengeful/2026-05-16.mdx",
      },
      done: {
        status: "pending",
      },
    },
  };
}

test("validates the transcribe checkpoint shape", () => {
  assert.deepEqual(parseTranscribeCheckpoint(sampleCheckpoint()), sampleCheckpoint());
});

test("validates optional Hermes reconciliation metadata", () => {
  const checkpoint = sampleCheckpoint();
  checkpoint.stages.correction_pass = {
    ...checkpoint.stages.correction_pass,
    reviewProvider: "hermes",
    reconciledTranscriptPath:
      "astro/.bf-transcripts/session1/reconciled_transcript.md",
    hermesReviewNotesPath:
      "astro/.bf-transcripts/session1/hermes_review_notes.md",
    finalTranscriptPath:
      "astro/.bf-transcripts/session1/reconciled_transcript.md",
    finalCorrectionNotesPath:
      "astro/.bf-transcripts/session1/hermes_review_notes.md",
  };

  assert.deepEqual(parseTranscribeCheckpoint(checkpoint), checkpoint);
});

test("rejects invalid checkpoint status values", () => {
  const checkpoint = sampleCheckpoint() as unknown as {
    stages: { normalization: { status: string } };
  };
  checkpoint.stages.normalization.status = "finished";

  assert.throws(() => parseTranscribeCheckpoint(checkpoint), /Invalid option/);
});

test("rejects malformed chunk indexes", () => {
  const checkpoint = sampleCheckpoint() as unknown as {
    stages: { transcribed_chunks: { completed: number[] } };
  };
  checkpoint.stages.transcribed_chunks.completed = [0, -1];

  assert.throws(() => parseTranscribeCheckpoint(checkpoint), />=0/);
});

test("writes checkpoint files atomically and reads them back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-checkpoint-test-"));
  try {
    const path = getCheckpointPath(dir);
    await writeTranscribeCheckpoint(path, sampleCheckpoint());

    assert.deepEqual(await readTranscribeCheckpoint(path), sampleCheckpoint());
    assert.equal(await readFile(`${path}.tmp`, "utf8").catch(() => undefined), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns undefined for a missing checkpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-checkpoint-test-"));
  try {
    assert.equal(await readTranscribeCheckpoint(join(dir, "missing.json")), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("throws for corrupt checkpoint JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-checkpoint-test-"));
  try {
    const path = getCheckpointPath(dir);
    await writeFile(path, "{not json", "utf8");

    await assert.rejects(() => readTranscribeCheckpoint(path), SyntaxError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
