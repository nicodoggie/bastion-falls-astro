import assert from "node:assert/strict";
import { test } from "node:test";

import {
  correctionNotesChunksDirFor,
  correctedTranscriptionDirFor,
  joinCorrectionNoteChunks,
  joinCorrectedTranscriptChunks,
  naturalTranscriptChunkSort,
} from "./codex.js";

test("sorts raw transcript chunks by session index", () => {
  const sorted = [
    "/tmp/session_010.md",
    "/tmp/session_002.md",
    "/tmp/session_001.md",
  ].sort(naturalTranscriptChunkSort);

  assert.deepEqual(sorted, [
    "/tmp/session_001.md",
    "/tmp/session_002.md",
    "/tmp/session_010.md",
  ]);
});

test("joins corrected transcript chunks without dropping lines", () => {
  const joined = joinCorrectedTranscriptChunks([
    "[00:00:01 - 00:00:02] first line\n",
    "[00:00:03 - 00:00:04] second line",
    "\n[00:00:05 - 00:00:06] third line\n",
  ]);

  assert.equal(joined, [
    "[00:00:01 - 00:00:02] first line",
    "[00:00:03 - 00:00:04] second line",
    "[00:00:05 - 00:00:06] third line",
    "",
  ].join("\n"));
});

test("uses corrected_transcription as the chunked corrected output directory", () => {
  assert.equal(correctedTranscriptionDirFor("/tmp/session1"), "/tmp/session1/corrected_transcription");
});

test("uses correction_notes_chunks as the chunked correction notes output directory", () => {
  assert.equal(correctionNotesChunksDirFor("/tmp/session1"), "/tmp/session1/correction_notes_chunks");
});

test("joins correction note chunks with source headings", () => {
  const joined = joinCorrectionNoteChunks([
    { name: "session_000.md", text: "- Malthrek corrected\n" },
    { name: "session_001.md", text: "\nNone.\n" },
  ]);

  assert.equal(joined, [
    "# Correction Notes",
    "",
    "## session_000",
    "",
    "- Malthrek corrected",
    "",
    "## session_001",
    "",
    "None.",
    "",
  ].join("\n"));
});
