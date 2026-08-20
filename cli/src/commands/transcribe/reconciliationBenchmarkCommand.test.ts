import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createBenchmarkExecutors, parseLanes, type BenchmarkAdapterDependencies } from "./reconciliationBenchmarkCommand.js";
import type { Manifest } from "./types.js";

const manifest: Manifest = {
  version: 2,
  source: "/synthetic.wav",
  sourceFingerprint: { sizeBytes: 10, mtimeMs: 20 },
  sourceProbe: { durationSeconds: 10, channels: 2, sampleRate: 16000 },
  normalizedStereo: "/normalized.flac",
  preparedChannels: [],
  audioSettings: { denoise: false, voiceBoost: false, sampleRate: 16000 },
  chunkSettings: { chunkSeconds: 10, boundarySearchSeconds: 1, boundaryMaxSearchSeconds: 2, overlapSeconds: 0, keepSilence: true, silencePaddingSeconds: 0, minimumSpeechSeconds: 0 },
  durationSeconds: 10,
  chunks: [{ index: 0, start: 0, end: 10, overlapStart: 0, overlapEnd: 10, endReason: "duration-end" }],
};

const options = (root: string) => ({
  campaign: "synthetic",
  sessionDate: "2026-08-20",
  contextRoot: root,
  maxTurns: 4,
  promptVersion: "reconciliation.prompt.v1",
  schemaVersion: "reconciliation.v1",
  repositoryCwd: root,
});

test("parses a distinct bounded lane list", () => {
  assert.deepEqual(parseLanes("window-3, baseline"), ["window-3", "baseline"]);
  assert.throws(() => parseLanes("single,single"), /distinct/iu);
  assert.throws(() => parseLanes("unknown"));
});

test("routes baseline only to legacy and candidates only to unified layouts", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchmark-adapters-"));
  const sourceDir = join(root, "source");
  const baselineRoot = join(root, "baseline");
  const singleRoot = join(root, "single");
  const windowRoot = join(root, "window-3");
  await Promise.all([sourceDir, baselineRoot, singleRoot, windowRoot].map((path) => mkdir(path, { recursive: true })));
  await writeFile(join(sourceDir, "corrected_transcript.md"), "approved\n");
  await writeFile(join(baselineRoot, "corrected_transcript.md"), "approved\n");
  let legacySummary = 0, legacyNotes = 0, unifiedStage = 0, unifiedNotes = 0;
  const layouts: string[] = [];
  const chunk = {
    chunk: { id: "session_000", start: 0, end: 10 }, schemaVersion: "reconciliation.v1", promptVersion: "reconciliation.prompt.v1", cacheIdentity: {},
    blocks: [{ id: "b", start: 0, end: 2, kind: "dialogue", text: "Readable", summarySafeText: "Safe", characterConfidence: "unknown", attributionBasis: ["source"], sourceEventIds: ["e"], reviewFlags: [] }],
    omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: "valid", errors: [] }, status: "valid",
  };
  const deps: BenchmarkAdapterDependencies = {
    runCodexSummaryCleanup: (async (input: { summaryTranscriptPath: string }) => { legacySummary += 1; await writeFile(input.summaryTranscriptPath, "summary\n"); }) as never,
    runCodexNotes: (async (input: { notesPath: string }) => { legacyNotes += 1; await writeFile(input.notesPath, "notes\n"); }) as never,
    runUnifiedReconciliationStage: (async (input: { layout: string; rootDir: string; channelMap: { version: number } }) => { unifiedStage += 1; layouts.push(input.layout); assert.equal(input.channelMap.version, 1); await mkdir(join(input.rootDir, "reconciliation"), { recursive: true }); await writeFile(join(input.rootDir, "reconciliation", "session_000.json"), "{}\n"); return { status: "valid", metadata: {}, chunks: [chunk], jobs: [{ packet: { chunk: { id: "session_000" } }, authoritativeSourceEvents: [{ id: "e", text: "Source", start: 0, end: 2 }] }] }; }) as never,
    runUnifiedStructuredNotes: (async (input: { notePath?: string }) => { unifiedNotes += 1; await writeFile(input.notePath!, "notes\n"); return {}; }) as never,
    loadCandidateInputs: (async () => ({ manifest, alignments: { "0": { version: 1, events: [] } }, channelMap: { version: 1, source: "/synthetic.wav", channels: [] } })) as never,
    loadSharedContext: (async () => ({ rules: "rule", excerpt: "context" })) as never,
    readCheckpoint: (async () => undefined) as never,
    collectReceipt: (async () => ({ version: 1, entries: [], receiptSha256: "a".repeat(64) })) as never,
  };
  try {
    const executors = createBenchmarkExecutors(options(root), deps);
    await executors.baseline({ lane: "baseline", rootDir: baselineRoot, sourceDir, layout: "legacy" });
    assert.deepEqual([legacySummary, legacyNotes, unifiedStage, unifiedNotes], [1, 1, 0, 0]);
    await executors.single({ lane: "single", rootDir: singleRoot, sourceDir, layout: "single" });
    await executors["window-3"]({ lane: "window-3", rootDir: windowRoot, sourceDir, layout: "three" });
    assert.deepEqual(layouts, ["single", "three"]);
    assert.deepEqual([legacySummary, legacyNotes, unifiedStage, unifiedNotes], [1, 1, 2, 2]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("candidate missing required source inputs fails before model invocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchmark-missing-input-"));
  let modelCalls = 0;
  try {
    const executors = createBenchmarkExecutors(options(root), {
      runUnifiedReconciliationStage: (async () => { modelCalls += 1; throw new Error("must not run"); }) as never,
    });
    await assert.rejects(() => executors.single({ lane: "single", rootDir: root, sourceDir: root, layout: "single" }), /manifest/iu);
    assert.equal(modelCalls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects oversized lane artifacts before reporting success", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchmark-output-bound-"));
  const sourceDir = join(root, "source"), laneRoot = join(root, "baseline");
  await mkdir(sourceDir); await mkdir(laneRoot);
  await writeFile(join(sourceDir, "corrected_transcript.md"), "approved\n");
  await writeFile(join(laneRoot, "corrected_transcript.md"), "approved\n");
  try {
    const executors = createBenchmarkExecutors(options(root), {
      loadSharedContext: (async () => ({ rules: "", excerpt: "" })) as never,
      runCodexSummaryCleanup: (async (input: { summaryTranscriptPath: string }) => { await writeFile(input.summaryTranscriptPath, "summary"); }) as never,
      runCodexNotes: (async (input: { notesPath: string }) => { await writeFile(input.notesPath, "x"); await truncate(input.notesPath, 64 * 1024 * 1024 + 1); }) as never,
    });
    await assert.rejects(() => executors.baseline({ lane: "baseline", rootDir: laneRoot, sourceDir, layout: "legacy" }), /byte bounds/iu);
  } finally { await rm(root, { recursive: true, force: true }); }
});
