import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseAlignmentResult } from "./alignment.js";
import type { ChannelMap } from "./channelMap.js";
import { parseTranscribeCheckpoint, type ReconciliationMetadata, type TranscribeCheckpointV2, type TranscribeCheckpointV3 } from "./checkpoint.js";
import { executeTranscriptionPipeline, parseStopAfter, sttCacheIdentity } from "./pipeline.js";
import type { ResolvedTranscriptionProfile } from "./settings.js";
import type { TranscribePassRequest } from "./sttBackend.js";
import type { Manifest } from "./types.js";

const profile = (layout: "stereo" | "hybrid", name: string = layout, targetName = "shared", model = "base"): ResolvedTranscriptionProfile => ({
  name, layout, target: { name: targetName, provider: "nodejs-whisper", model },
});

function checkpoint(outDir: string, layout: "stereo" | "hybrid" = "stereo"): TranscribeCheckpointV3 {
  const now = new Date().toISOString();
  const passes = layout === "stereo" ? ["stereo"] : ["stereo", "left", "right"];
  const available = [0, 1];
  const legacy: TranscribeCheckpointV2 = { version: 2, updatedAt: now, source: "/source.wav", outDir, sessionDate: "2026-08-12", campaign: "test", profile: layout, layout,
    stages: {
      normalization: { status: "pending", path: join(outDir, "normalized.flac") },
      audio_chunking: { status: "pending", count: 2, dir: join(outDir, "chunks"), requiredPasses: passes, availableByPass: Object.fromEntries(passes.map((p) => [p, available])) },
      transcribed_chunks: { status: "pending", requiredPasses: passes, completedByPass: Object.fromEntries(passes.map((p) => [p, []])), selection: available, total: 2, rawChunksDir: join(outDir, "raw_chunks"), rawTranscriptionDir: join(outDir, "raw_transcription") },
      joining_raw_transcription: { status: "pending", path: join(outDir, "raw_transcript.md") }, correction_pass: { status: "pending" }, notes_summary_pass: { status: "pending" }, done: { status: "pending" },
    } };
  return parseTranscribeCheckpoint(legacy);
}

const manifest: Manifest = {
  version: 2, source: "/source.wav", sourceFingerprint: { sizeBytes: 10, mtimeMs: 20 }, sourceProbe: { durationSeconds: 20, channels: 2, sampleRate: 16000 }, normalizedStereo: "/normalized.flac",
  preparedChannels: [{ id: "left", index: 0, path: "/left.flac" }, { id: "right", index: 1, path: "/right.flac" }], audioSettings: { denoise: false, voiceBoost: false, sampleRate: 16000 },
  chunkSettings: { chunkSeconds: 10, boundarySearchSeconds: 1, boundaryMaxSearchSeconds: 2, overlapSeconds: 0, keepSilence: true, silencePaddingSeconds: 0, minimumSpeechSeconds: 0 }, durationSeconds: 20,
  chunks: [{ index: 0, start: 0, end: 10, overlapStart: 0, overlapEnd: 10, endReason: "exact-target" }, { index: 1, start: 10, end: 20, overlapStart: 10, overlapEnd: 20, endReason: "duration-end" }],
};

const channelMap: ChannelMap = {
  version: 1,
  source: manifest.source,
  channels: [
    { id: "left", index: 0, speakers: [{ name: "Nico", role: "player", expectedCharacters: [{ name: "Andrew", aliases: [] }] }] },
    { id: "right", index: 1, speakers: [{ name: "Ran", role: "player", expectedCharacters: [{ name: "Hellion", aliases: [] }] }] },
  ],
};

function prepared(outDir: string, p: ResolvedTranscriptionProfile, map?: ChannelMap) { return { manifest, profile: p, rawChunksDir: join(outDir, "raw_chunks"), rawTranscriptionDir: join(outDir, "raw_transcription"), chunksDir: join(outDir, "chunks"), source: manifest.source, channelMap: map }; }

function reconciliationMetadata(outDir: string, status: ReconciliationMetadata["status"], token: string): ReconciliationMetadata {
  const dir = join(outDir, "reconciliation");
  return {
    provider: "hermes",
    mode: "enabled",
    reconciliationDir: dir,
    reconciledTranscriptPath: join(outDir, "reconciled_transcript.md"),
    summaryTranscriptPath: join(outDir, "summary_transcript.md"),
    reviewQueuePath: join(outDir, "reconciliation_review_queue.md"),
    schemaVersion: "reconciliation.v1",
    promptVersion: "reconciliation.prompt.v1",
    cacheIdentityByChunk: { session_000: token, session_001: `${token}-1` },
    completedChunkIds: ["session_000", "session_001"],
    status,
    summarySafety: { pendingChunkIds: [], bypassChunkIds: [] },
  };
}

test("canonicalizes reconciliation stop aliases", () => {
  assert.equal(parseStopAfter("reconciliation"), "reconciliation");
  assert.equal(parseStopAfter("correction-review"), "reconciliation");
  assert.equal(parseStopAfter("correction_review"), "reconciliation");
  assert.throws(() => parseStopAfter("correction"), /reconciliation/iu);
});

test("routes reconciliation outcomes, compatibility, and downstream identity changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-reconciliation-"));
  const dependencies = { nodejsWhisper: async (request: { chunks: Array<{ index: number }> }) => [{ segments: [{ start: 0, end: 1, text: `chunk ${request.chunks[0]!.index}` }] }] };
  const run = (state: TranscribeCheckpointV3, options: {
    status?: "valid" | "needs_review" | "invalid" | "skipped";
    metadataStatus?: ReconciliationMetadata["status"];
    token?: string;
    stopAfter?: "reconciliation";
    notes?: () => Promise<"complete" | "skipped">;
    compatibility?: boolean;
  }) => executeTranscriptionPipeline({
    checkpoint: state,
    checkpointPath: join(state.outDir, "checkpoint.json"),
    rawChunksDir: join(state.outDir, "raw_chunks"),
    rawTranscriptionDir: join(state.outDir, "raw_transcription"),
    chunksDir: join(state.outDir, "chunks"),
    source: manifest.source,
    language: "en",
    stopAfter: options.stopAfter,
    dependencies,
    normalize: async () => undefined,
    prepareAudio: async () => prepared(state.outDir, profile("stereo")),
    stages: {
      rawAssembly: async () => undefined,
      ...(options.compatibility
        ? { correctionReview: async () => options.status === "skipped" ? "skipped" as const : "complete" as const }
        : options.status
          ? { reconciliation: async () => ({ status: options.status!, metadata: reconciliationMetadata(state.outDir, options.metadataStatus ?? (options.status === "skipped" ? "pending" : options.status!), options.token ?? "cache") }) }
          : {}),
      ...(options.notes ? { notes: options.notes } : {}),
    },
  });

  try {
    let notes = 0;
    const valid = checkpoint(join(root, "valid"));
    await run(valid, { status: "valid", stopAfter: "reconciliation", notes: async () => { notes += 1; return "complete"; } });
    assert.equal(valid.stages.reconciliation.status, "complete");
    assert.equal(valid.stages.reconciliation.metadata.status, "valid");
    assert.equal(notes, 0);

    const review = checkpoint(join(root, "needs-review"));
    await run(review, { status: "needs_review", notes: async () => { notes += 1; return "complete"; } });
    assert.equal(review.stages.reconciliation.status, "complete");
    assert.equal(review.stages.reconciliation.metadata.status, "needs_review");
    assert.equal(review.stages.done.status, "complete");
    assert.equal(notes, 1);

    const invalid = checkpoint(join(root, "invalid"));
    await assert.rejects(() => run(invalid, { status: "invalid", notes: async () => { notes += 1; return "complete"; } }), /reconciliation failed/iu);
    assert.equal(invalid.stages.reconciliation.status, "failed");
    assert.equal(invalid.stages.reconciliation.completedAt, undefined);
    assert.match(invalid.stages.reconciliation.error ?? "", /validation failed/iu);
    assert.equal(invalid.stages.notes_summary_pass.status, "pending");
    assert.equal(notes, 1);
    const persistedInvalid = JSON.parse(await readFile(join(invalid.outDir, "checkpoint.json"), "utf8"));
    assert.equal(persistedInvalid.stages.reconciliation.status, "failed");
    assert.match(persistedInvalid.stages.reconciliation.error, /validation failed/iu);

    const mismatch = checkpoint(join(root, "status-mismatch"));
    await assert.rejects(
      () => run(mismatch, { status: "valid", metadataStatus: "invalid", notes: async () => { notes += 1; return "complete"; } }),
      /status disagrees/iu,
    );
    assert.equal(mismatch.stages.notes_summary_pass.status, "pending");
    assert.equal(notes, 1);

    const disabled = checkpoint(join(root, "disabled"));
    await run(disabled, { compatibility: true, status: "skipped", notes: async () => "skipped" });
    assert.equal(disabled.stages.reconciliation.status, "skipped");
    assert.equal(disabled.stages.reconciliation.metadata.provider, "off");
    assert.equal(disabled.stages.done.status, "complete");

    const changing = checkpoint(join(root, "identity-change"));
    let changingNotes = 0;
    await run(changing, { status: "valid", token: "first", notes: async () => { changingNotes += 1; return "complete"; } });
    changing.stages.reconciliation.status = "pending";
    changing.stages.reconciliation.completedAt = undefined;
    changing.stages.notes_summary_pass.status = "pending";
    changing.stages.notes_summary_pass.completedAt = undefined;
    changing.stages.done.status = "pending";
    changing.stages.done.completedAt = undefined;
    await run(changing, { status: "valid", token: "second", notes: async () => { changingNotes += 1; return "complete"; } });
    assert.equal(changingNotes, 2);
    assert.equal(changing.stages.reconciliation.metadata.cacheIdentityByChunk["session_000"], "second");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("routes a profile prompt into STT requests and cache identity", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "pipeline-profile-prompt-"));
  const state = checkpoint(outDir);
  const configuredProfile: ResolvedTranscriptionProfile = {
    ...profile("stereo", "prompted"),
    prompt: "Preserve Tagalog and D&D names.",
  };
  const prompts: Array<string | undefined> = [];

  await executeTranscriptionPipeline({
    checkpoint: state,
    checkpointPath: join(outDir, "checkpoint.json"),
    rawChunksDir: join(outDir, "raw_chunks"),
    rawTranscriptionDir: join(outDir, "raw_transcription"),
    chunksDir: join(outDir, "chunks"),
    source: manifest.source,
    language: "en",
    selection: "0",
    stopAfter: "transcription",
    dependencies: {
      nodejsWhisper: async (request: TranscribePassRequest) => {
        prompts.push(request.prompt);
        return [{ segments: [{ start: 0, end: 1, text: "Andrew answers." }] }];
      },
    },
    normalize: async () => undefined,
    prepareAudio: async () => prepared(outDir, configuredProfile),
  });

  assert.deepEqual(prompts, ["Preserve Tagalog and D&D names."]);
  assert.deepEqual(
    Object.keys(state.stages.transcribed_chunks.cacheIdentityByPass ?? {}),
    ["stereo"],
  );
  assert.match(
    String(Object.values(state.stages.transcribed_chunks.cacheIdentityByPass ?? {})[0] ?? ""),
    /Preserve Tagalog and D&D names\./,
  );
});

test("proves the complete staged lifecycle, resume contract, hooks, and cache identity", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "pipeline-lifecycle-"));
  const calls: string[] = [];
  const hookCalls: string[] = [];
  let energyCalls = 0;
  const dependencies = { nodejsWhisper: async (request: { pass: { id: string }; chunks: Array<{ index: number }> }) => { calls.push(`${request.pass.id}:${request.chunks[0]!.index}`); return [{ segments: [{ start: 0, end: 1, text: `The Monadists ${request.chunks[0]!.index}` }] }]; } };
  const run = (state: TranscribeCheckpointV3, p: ResolvedTranscriptionProfile, stopAfter?: Parameters<typeof executeTranscriptionPipeline>[0]["stopAfter"], stages?: Parameters<typeof executeTranscriptionPipeline>[0]["stages"], selection?: string, map: ChannelMap | undefined = p.layout === "hybrid" ? channelMap : undefined) => executeTranscriptionPipeline({ checkpoint: state, checkpointPath: join(state.outDir, "checkpoint.json"), rawChunksDir: join(state.outDir, "raw_chunks"), rawTranscriptionDir: join(state.outDir, "raw_transcription"), chunksDir: join(state.outDir, "chunks"), source: manifest.source, language: "en", selection, stopAfter, dependencies, measureEnergy: async ({ path }) => { energyCalls += 1; return path.includes("left") ? 9 : 1; }, normalize: async () => { hookCalls.push("normalization"); }, prepareAudio: async () => { hookCalls.push("audio-chunking"); return prepared(state.outDir, p, map); }, stages });

  const state = checkpoint(outDir);
  await run(state, profile("stereo"), "normalization");
  assert.deepEqual(hookCalls, ["normalization"]);
  assert.equal(state.stages.normalization.status, "complete");
  assert.ok(state.stages.normalization.completedAt);
  assert.equal(state.stages.audio_chunking.status, "pending");

  await run(state, profile("stereo"), "audio-chunking");
  assert.deepEqual(hookCalls, ["normalization", "normalization", "audio-chunking"]);
  assert.deepEqual(calls, []);
  assert.equal(state.stages.audio_chunking.status, "complete");
  assert.ok(state.stages.audio_chunking.completedAt);
  assert.equal(state.stages.transcribed_chunks.status, "pending");

  await run(state, profile("stereo"), "transcription", undefined, "0");
  assert.deepEqual(calls, ["stereo:0"]);
  state.layout = "hybrid"; state.profile = "hybrid";
  await run(state, profile("hybrid"), "transcription", undefined, "0");
  assert.deepEqual(calls, ["stereo:0", "left:0", "right:0"]);
  assert.equal(state.stages.transcribed_chunks.status, "in_progress");
  assert.equal(state.stages.joining_raw_transcription.status, "pending");
  assert.equal(state.stages.done.status, "pending");
  await run(state, profile("hybrid"), "raw-assembly");
  assert.deepEqual(calls, ["stereo:0", "left:0", "right:0", "stereo:1", "left:1", "right:1"]);
  assert.equal(state.stages.transcribed_chunks.status, "complete");
  assert.equal(state.stages.joining_raw_transcription.status, "complete");
  assert.equal(state.stages.done.status, "pending");

  for (const index of [0, 1]) {
    const alignmentPath = join(outDir, "raw_transcription", "alignment", `session_${String(index).padStart(3, "0")}.json`);
    const alignment = parseAlignmentResult(JSON.parse(await readFile(alignmentPath, "utf8")) as unknown);
    assert.equal(alignment.events[0]?.sourcePass, "stereo");
    assert.equal(alignment.events[0]?.physicalSpeaker, "Nico");
    assert.deepEqual(alignment.events[0]?.alternatives.map((item) => item.sourcePass), ["left", "right"]);
  }
  assert.match(await readFile(join(outDir, "raw_transcript.md"), "utf8"), /\[channel:left\] \[speaker:Nico\] The Monadists/);

  const callsAfterHybrid = calls.length;
  const energyAfterHybrid = energyCalls;
  const firstAlignmentPath = join(outDir, "raw_transcription", "alignment", "session_000.json");
  await writeFile(firstAlignmentPath, "{}\n", "utf8");
  await run(state, profile("hybrid"), "raw-assembly");
  assert.equal(calls.length, callsAfterHybrid);
  assert.ok(energyCalls > energyAfterHybrid);
  parseAlignmentResult(JSON.parse(await readFile(firstAlignmentPath, "utf8")) as unknown);

  const energyAfterRepair = energyCalls;
  const changedMap: ChannelMap = structuredClone(channelMap);
  changedMap.channels[0]!.speakers[0]!.expectedCharacters.push({ name: "Sapphire", aliases: [] });
  await run(state, profile("hybrid"), "raw-assembly", undefined, undefined, changedMap);
  assert.equal(calls.length, callsAfterHybrid);
  assert.ok(energyCalls > energyAfterRepair);
  const energyAfterMetadata = energyCalls;
  await run(state, profile("hybrid"), "raw-assembly", undefined, undefined, changedMap);
  assert.equal(calls.length, callsAfterHybrid);
  assert.equal(energyCalls, energyAfterMetadata);

  await rm(join(outDir, "raw_transcript.md"));
  await run(state, profile("hybrid"), "raw-assembly", undefined, undefined, changedMap);
  assert.equal(calls.length, callsAfterHybrid);
  assert.ok(energyCalls > energyAfterMetadata);
  assert.match(await readFile(join(outDir, "raw_transcript.md"), "utf8"), /The Monadists/);

  const staleMap: ChannelMap = { ...changedMap, source: "/another-recording.wav" };
  const callsBeforeStaleMap = calls.length;
  await assert.rejects(run(state, profile("hybrid"), "raw-assembly", undefined, undefined, staleMap), /channel map is incompatible.*source/i);
  assert.equal(calls.length, callsBeforeStaleMap);

  for (const pass of ["stereo", "left", "right"]) for (const index of [0, 1]) {
    const base = pass === "stereo" ? join(outDir, "raw_chunks") : join(outDir, "raw_chunks", "passes", pass);
    const markdown = pass === "stereo" ? join(outDir, "raw_transcription", `session_${String(index).padStart(3, "0")}.md`) : join(outDir, "raw_transcription", "passes", pass, `session_${String(index).padStart(3, "0")}.md`);
    assert.ok((await readFile(join(base, `session_${String(index).padStart(3, "0")}.json`), "utf8")).trim());
    assert.ok((await readFile(markdown, "utf8")).trim());
  }

  const missingHookState = checkpoint(join(outDir, "missing-hook"));
  await assert.rejects(
    run(missingHookState, profile("stereo"), "correction-review", {
      rawAssembly: async () => { hookCalls.push("missing-hook-raw"); },
    }),
    /stages\.reconciliation.*reconciliation stage/i,
  );
  assert.equal(missingHookState.stages.joining_raw_transcription.status, "complete");
  assert.equal(missingHookState.stages.reconciliation.status, "pending");
  assert.equal(missingHookState.stages.done.status, "pending");

  const missingNotesState = checkpoint(join(outDir, "missing-notes"));
  await assert.rejects(
    run(missingNotesState, profile("stereo"), undefined, {
      correctionReview: async () => "complete",
    }),
    /stages\.notes.*stereo notes/i,
  );
  assert.equal(missingNotesState.stages.reconciliation.status, "complete");
  assert.equal(missingNotesState.stages.reconciliation.metadata.provider, "legacy");
  assert.equal(missingNotesState.stages.notes_summary_pass.status, "pending");
  assert.equal(missingNotesState.stages.done.status, "pending");

  const correctionCalls: string[] = [];
  const correctionState = checkpoint(join(outDir, "correction-cutoff"));
  await run(correctionState, profile("stereo"), "correction-review", {
    rawAssembly: async () => { correctionCalls.push("raw-assembly"); },
    correctionReview: async () => { correctionCalls.push("correction-review"); return "complete"; },
    notes: async () => { correctionCalls.push("notes"); return "complete"; },
  });
  assert.deepEqual(correctionCalls, ["raw-assembly", "correction-review"]);
  assert.equal(correctionState.stages.reconciliation.status, "complete");
  assert.equal(correctionState.stages.notes_summary_pass.status, "pending");
  assert.equal(correctionState.stages.done.status, "pending");

  const notesCalls: string[] = [];
  const notesState = checkpoint(join(outDir, "notes-cutoff"));
  await run(notesState, profile("stereo"), "notes", {
    rawAssembly: async () => { notesCalls.push("raw-assembly"); },
    correctionReview: async () => { notesCalls.push("correction-review"); return "complete"; },
    notes: async () => { notesCalls.push("notes"); return "complete"; },
  });
  assert.deepEqual(notesCalls, ["raw-assembly", "correction-review", "notes"]);
  assert.equal(notesState.stages.notes_summary_pass.status, "complete");
  assert.equal(notesState.stages.done.status, "pending");

  const fullCalls: string[] = [];
  const fullState = checkpoint(join(outDir, "full"));
  await run(fullState, profile("stereo"), undefined, {
    rawAssembly: async () => { fullCalls.push("raw-assembly"); },
    correctionReview: async () => { fullCalls.push("correction-review"); return "complete"; },
    notes: async () => { fullCalls.push("notes"); return "complete"; },
  });
  assert.deepEqual(fullCalls, ["raw-assembly", "correction-review", "notes"]);
  assert.equal(fullState.stages.done.status, "complete");
  assert.equal(fullState.updatedAt, fullState.stages.done.completedAt);
  const persistedFull = parseTranscribeCheckpoint(JSON.parse(await readFile(join(fullState.outDir, "checkpoint.json"), "utf8")));
  assert.equal(persistedFull.updatedAt, persistedFull.stages.done.completedAt);
  const callsAfterFull = calls.length;
  await run(fullState, profile("stereo"), undefined, {
    rawAssembly: async () => { throw new Error("cached raw assembly reran"); },
    correctionReview: async () => { throw new Error("cached correction reran"); },
    notes: async () => { throw new Error("cached notes reran"); },
  });
  assert.equal(calls.length, callsAfterFull);
  assert.equal(fullState.stages.done.status, "complete");

  const cacheState = checkpoint(join(outDir, "cache-identity"));
  let normalizationRebuilds = 0;
  let audioRebuilds = 0;
  const cacheStages = {
    correctionReview: async () => "complete" as const,
    notes: async () => "complete" as const,
  };
  const runCached = (p: ResolvedTranscriptionProfile) => executeTranscriptionPipeline({
    checkpoint: cacheState,
    checkpointPath: join(cacheState.outDir, "checkpoint.json"),
    rawChunksDir: join(cacheState.outDir, "raw_chunks"),
    rawTranscriptionDir: join(cacheState.outDir, "raw_transcription"),
    chunksDir: join(cacheState.outDir, "chunks"),
    source: manifest.source,
    language: "en",
    dependencies,
    normalize: async () => { if (cacheState.stages.normalization.status === "pending") normalizationRebuilds += 1; },
    prepareAudio: async () => { if (cacheState.stages.audio_chunking.status === "pending") audioRebuilds += 1; return prepared(cacheState.outDir, p); },
    stages: cacheStages,
  });
  const callsBeforeCache = calls.length;
  await runCached(profile("stereo", "cache", "one"));
  assert.equal(calls.length, callsBeforeCache + 2);
  await runCached(profile("stereo", "cache", "two"));
  assert.equal(calls.length, callsBeforeCache + 4);
  assert.equal(normalizationRebuilds, 1);
  assert.equal(audioRebuilds, 1);

  const target = { name: "one", provider: "openai-compatible" as const, protocol: "openai" as const, baseUrl: "https://example.test/v1?secret=hidden#x", model: "base", timeoutSeconds: 900, retries: 2 };
  const identity = sttCacheIdentity({ manifest, pass: { kind: "stereo", id: "stereo" }, target, language: "en" });
  const changed = sttCacheIdentity({ manifest, pass: { kind: "stereo", id: "stereo" }, target: { ...target, name: "two" }, language: "en" });
  assert.ok(!identity.includes("secret") && identity !== changed);
});
