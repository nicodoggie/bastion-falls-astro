import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildCodexCorrectionNotesPrompt,
  buildCodexCorrectionPrompt,
  buildCodexFinalNotesPrompt,
  buildCodexSceneSummaryPrompt,
  buildCodexTranscriptSummaryPrompt,
  buildCodexRollingContextPrompt,
  buildSummaryCleanupPrompt,
  correctionContextChunksDirFor,
  correctionNotesChunksDirFor,
  codexNotesDirFor,
  formatCodexNotesSceneProgress,
  formatSummaryCleanupJoinMessage,
  formatSummaryCleanupProgress,
  formatSummaryCleanupWriteMessage,
  correctedTranscriptionDirFor,
  joinCodexSceneSummaries,
  joinCorrectionNoteChunks,
  joinCorrectedTranscriptChunks,
  naturalTranscriptChunkSort,
  summaryTranscriptionDirFor,
  writeGeneratedFile,
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

test("uses correction_context_chunks for rolling correction context", () => {
  assert.equal(correctionContextChunksDirFor("/tmp/session1"), "/tmp/session1/correction_context_chunks");
});

test("uses codex_notes as the compacted notes workspace", () => {
  assert.equal(codexNotesDirFor("/tmp/session1"), "/tmp/session1/codex_notes");
});

test("uses summary_transcription as the cleaned transcript output directory", () => {
  assert.equal(summaryTranscriptionDirFor("/tmp/session1"), "/tmp/session1/summary_transcription");
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

test("joins Codex scene summaries with separators for the final notes prompt", () => {
  assert.equal(
    joinCodexSceneSummaries(["First scene\n", "\nSecond scene"]),
    "First scene\n\n---\n\nSecond scene",
  );
});

test("builds rolling context prompts from prior context and latest summary", () => {
  const prompt = buildCodexRollingContextPrompt({
    previousContext: "- The party entered the manor.",
    latestSummary: "- They discovered the disguised hallway.",
  });

  assert.match(prompt, /Update the rolling campaign context/);
  assert.match(prompt, /<previous-rolling-context>/);
  assert.match(prompt, /The party entered the manor/);
  assert.match(prompt, /<latest-chunk-summary>/);
  assert.match(prompt, /discovered the disguised hallway/);
});

test("builds summary cleanup prompts that preserve transcript shape", () => {
  const prompt = buildSummaryCleanupPrompt({
    transcriptChunk: "[00:00:01 - 00:00:04] The party entered the keep.",
  });

  assert.match(prompt, /Prepare this D&D transcript chunk for downstream summarization/);
  assert.match(prompt, /Do not summarize/);
  assert.match(prompt, /Preserve timestamps/);
  assert.match(prompt, /neutral, summary-safe wording/);
  assert.match(prompt, /<transcript-chunk>/);
  assert.match(prompt, /party entered the keep/);
});

test("includes shared correction rules in correction prompts", () => {
  const prompt = buildCodexCorrectionPrompt({
    rollingContext: "",
    glossary: "- Sensodyne",
    correctionRules: "- character.sensodyne: Use Sensodyne.",
    transcript: "[00:00:01 - 00:00:02] Sensudine",
  });

  assert.match(prompt, /<correction-rules>/);
  assert.match(prompt, /character\.sensodyne/);
  assert.match(prompt, /Use Sensodyne/);
});

test("includes shared correction rules in notes prompts", () => {
  const chunkPrompt = buildCodexTranscriptSummaryPrompt({
    rollingContext: "",
    contextExcerpt: "## Context",
    correctionNotes: "- Local uncertainty",
    correctionRules: "- artifact.sabina: Do not canonize Sabina.",
    transcriptChunk: "Sabina.",
  });
  const scenePrompt = buildCodexSceneSummaryPrompt({
    correctionRules: "- artifact.sabina: Do not canonize Sabina.",
    chunkSummaries: ["- Apparent Sabina artifact."],
  });
  const finalPrompt = buildCodexFinalNotesPrompt({
    frontmatter: "---\ntitle: Test\n---\n",
    correctionRules: "- artifact.sabina: Do not canonize Sabina.",
    sceneSummaries: ["- Apparent Sabina artifact."],
  });

  for (const prompt of [chunkPrompt, scenePrompt, finalPrompt]) {
    assert.match(prompt, /<correction-rules>/);
    assert.match(prompt, /artifact\.sabina/);
  }
});

test("describes final campaign note output format explicitly", () => {
  const prompt = buildCodexFinalNotesPrompt({
    frontmatter: "---\ntitle: Test\n---\n",
    correctionRules: "- artifact.sabina: Do not canonize Sabina.",
    sceneSummaries: ["- Apparent Sabina artifact."],
  });

  assert.match(prompt, /Write readable campaign notes, not a correction changelog/);
  assert.match(prompt, /Use this output structure after the frontmatter/);
  assert.match(prompt, /## Summary/);
  assert.match(prompt, /- \{summary bullet\}/);
  assert.match(prompt, /## Open Hooks/);
  assert.match(prompt, /- \{hook bullet\}/);
  assert.match(prompt, /- \{hook bullet\}\n\n### Confirmations Needed/);
  assert.match(prompt, /### Confirmations Needed/);
  assert.match(prompt, /- \{confirmation bullet\}/);
  assert.match(prompt, /- \{confirmation bullet\}\n\n### Boundaries/);
  assert.match(prompt, /### Boundaries/);
  assert.match(prompt, /- \{boundary bullet\}/);
  assert.match(prompt, /Summary contains the readable campaign recap/);
  assert.match(prompt, /Confirmations Needed contains only live checks/);
  assert.match(prompt, /Boundaries contains only reader-facing interpretive constraints/);
  assert.match(prompt, /Apply settled correction rules directly/);
  assert.match(prompt, /Open Hooks section only for live unresolved/);
  assert.match(prompt, /Do not create .*Settled Clarifications/i);
  assert.match(prompt, /rejected ASR artifacts, table chatter exclusions, alias drift, or do-not-canonize guardrails/);
});

test("formats summary cleanup chunk progress states", () => {
  assert.equal(
    formatSummaryCleanupProgress({
      status: "starting",
      index: 0,
      total: 84,
      name: "session_000.md",
    }),
    "Starting summary-safe transcript chunk 1/84: session_000.md\n",
  );
  assert.equal(
    formatSummaryCleanupProgress({
      status: "finished",
      index: 0,
      total: 84,
      name: "session_000.md",
    }),
    "Finished summary-safe transcript chunk 1/84: session_000.md\n",
  );
  assert.equal(
    formatSummaryCleanupProgress({
      status: "reusing",
      index: 0,
      total: 84,
      name: "session_000.md",
    }),
    "Reusing summary-safe transcript chunk 1/84: session_000.md\n",
  );
});

test("formats summary cleanup write progress", () => {
  assert.equal(
    formatSummaryCleanupWriteMessage("/tmp/session1/summary_transcript.md"),
    "Wrote summary-safe transcript: /tmp/session1/summary_transcript.md\n",
  );
});

test("formats summary cleanup join progress", () => {
  assert.equal(
    formatSummaryCleanupJoinMessage({
      count: 84,
      path: "/tmp/session1/summary_transcript.md",
    }),
    "Joining 84 summary-safe chunks into /tmp/session1/summary_transcript.md\n",
  );
});

test("formats Codex notes scene progress states", () => {
  assert.equal(
    formatCodexNotesSceneProgress({
      status: "starting",
      index: 0,
      total: 17,
      chunkStart: 0,
      chunkEnd: 4,
      path: "/tmp/session/codex_notes/scenes/scene_000.md",
    }),
    "Starting Codex scene summary 1/17 from chunks 1-5: /tmp/session/codex_notes/scenes/scene_000.md\n",
  );
  assert.equal(
    formatCodexNotesSceneProgress({
      status: "finished",
      index: 0,
      total: 17,
      chunkStart: 0,
      chunkEnd: 4,
      path: "/tmp/session/codex_notes/scenes/scene_000.md",
    }),
    "Finished Codex scene summary 1/17 from chunks 1-5: /tmp/session/codex_notes/scenes/scene_000.md\n",
  );
  assert.equal(
    formatCodexNotesSceneProgress({
      status: "reusing",
      index: 0,
      total: 17,
      chunkStart: 0,
      chunkEnd: 4,
      path: "/tmp/session/codex_notes/scenes/scene_000.md",
    }),
    "Reusing Codex scene summary 1/17 from chunks 1-5: /tmp/session/codex_notes/scenes/scene_000.md\n",
  );
});

test("creates parent directories before running a file generator", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-codex-generated-file-"));
  const path = join(dir, "nested", "session_000.md");

  const generated = await writeGeneratedFile({
    path,
    force: false,
    resume: false,
    generate: async () => {
      await writeFile(path, "generated by tool\n", "utf8");
      return readFile(path, "utf8");
    },
  });

  assert.equal(generated, "generated by tool\n");
  assert.equal(await readFile(path, "utf8"), "generated by tool\n");
});
