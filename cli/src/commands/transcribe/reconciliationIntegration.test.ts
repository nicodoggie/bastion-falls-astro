import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { buildLogicalReconciliationWindows, prepareUnifiedReconciliationJobs, runUnifiedReconciliationStage, runUnifiedStructuredNotes, hashFileSha256 } from "./reconciliationIntegration.js";

const manifest = (count = 4) => ({ version: 2, durationSeconds: count * 10, chunkSettings: { chunkSeconds: 10 }, chunks: Array.from({ length: count }, (_, index) => ({ index, start: index * 10, end: (index + 1) * 10, endReason: index === count - 1 ? "duration-end" : "exact-target" })) }) as any;
const alignment = (i: number) => ({ version: 1 as const, events: [{ text: `event ${i}`, sourcePass: "stereo", globalStart: i * 10 + 1, globalEnd: i * 10 + 2, alternatives: [] }] });
const base = (layout: "single" | "per-stt-chunk" | "three" = "per-stt-chunk") => ({ manifest: manifest(), layout, alignments: [0, 1, 2, 3].map(alignment), sourceHash: "a".repeat(64), evidenceRevision: "rev-1", provider: { provider: "hermes", model: "test", profile: "default" } });
const canonicalFor = (job: ReturnType<typeof prepareUnifiedReconciliationJobs>["jobs"][number], summaryStatus: "valid" | "pending" = "valid") => ({ chunk: job.packet.chunk, schemaVersion: job.packet.schemaVersion, promptVersion: job.packet.promptVersion, cacheIdentity: job.packet.cacheIdentity, blocks: [{ id: "b", start: job.packet.ownedEvents[0]!.start, end: job.packet.ownedEvents[0]!.end, kind: "dialogue", text: "x", summarySafeText: summaryStatus === "valid" ? "x" : "", characterConfidence: "unknown", attributionBasis: ["source"], sourceEventIds: [job.packet.ownedEvents[0]!.id], reviewFlags: [] }], omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: summaryStatus, errors: summaryStatus === "valid" ? [] : ["pending"] }, status: "valid" as const } as any);

test("builds bounded single and independently owned three-chunk-context windows", () => {
  assert.deepEqual(buildLogicalReconciliationWindows(manifest(), "single").map((x) => x.chunkIndices), [[0], [1], [2], [3]]);
  assert.equal(buildLogicalReconciliationWindows(manifest(), "per-stt-chunk").length, 4);
  assert.deepEqual(buildLogicalReconciliationWindows(manifest(), "three").map((x) => x.chunkIndices), [[0], [1], [2], [3]]);
  assert.throws(() => buildLogicalReconciliationWindows(manifest(2), "three"));
  assert.throws(() => buildLogicalReconciliationWindows({ ...manifest(), durationSeconds: Number.NaN } as any, "single"));
});

test("merges only a duration-underfilled final window within the configured cap", () => {
  const withTail = (tailSeconds: number) => ({
    ...manifest(2), durationSeconds: 600 + tailSeconds, chunkSettings: { chunkSeconds: 600 },
    chunks: [
      { index: 0, start: 0, end: 600, endReason: "exact-target" },
      { index: 1, start: 600, end: 600 + tailSeconds, endReason: "duration-end" },
    ],
  }) as any;
  const options = { tailMergeThresholdRatio: 0.25, tailMergeMaxDurationRatio: 1.25 };
  assert.deepEqual(buildLogicalReconciliationWindows(withTail(58), "single", options).map((window) => window.chunkIndices), [[0, 1]]);
  assert.deepEqual(buildLogicalReconciliationWindows(withTail(150), "single", options).map((window) => window.chunkIndices), [[0], [1]]);
  assert.deepEqual(buildLogicalReconciliationWindows(withTail(599), "single", options).map((window) => window.chunkIndices), [[0], [1]]);
  assert.deepEqual(buildLogicalReconciliationWindows(withTail(58), "single", { ...options, tailMergeThresholdRatio: 0 }).map((window) => window.chunkIndices), [[0], [1]]);
  const overCap = withTail(58); overCap.chunks[0].end = 700; overCap.chunks[1].start = 700; overCap.chunks[1].end = 758; overCap.durationSeconds = 758;
  assert.deepEqual(buildLogicalReconciliationWindows(overCap, "single", options).map((window) => window.chunkIndices), [[0], [1]]);
});

test("merged final window preserves exact evidence ownership", () => {
  const mergedManifest = { ...manifest(2), durationSeconds: 12, chunkSettings: { chunkSeconds: 10 }, chunks: [
    { index: 0, start: 0, end: 10, endReason: "exact-target" },
    { index: 1, start: 10, end: 12, endReason: "duration-end" },
  ] } as any;
  const prepared = prepareUnifiedReconciliationJobs({ ...base(), manifest: mergedManifest, alignments: [alignment(0), alignment(1)], tailMergeThresholdRatio: 0.25, tailMergeMaxDurationRatio: 1.25 });
  assert.equal(prepared.jobs.length, 1);
  assert.deepEqual(prepared.windows[0]!.chunkIndices, [0, 1]);
  assert.equal(prepared.jobs[0]!.authoritativeSourceEvents.length, 2);
  assert.equal(new Set(prepared.jobs[0]!.authoritativeSourceEvents.map((event) => event.id)).size, 2);
});

test("prepares owned evidence and context without losing source fields", () => {
  const prepared = prepareUnifiedReconciliationJobs({ ...base(), previousReadableTail: ["previous"], neighborLimit: 1 });
  assert.equal(prepared.jobs.length, 4);
  assert.equal(prepared.jobs[1]!.packet.ownedEvents[0]!.text, "event 1");
  assert.equal(prepared.jobs[1]!.packet.context.nextAlignmentHead[0]!.text, "event 2");
  assert.equal(prepared.jobs[0]!.packet.context.previousReadableTail[0], "previous");
  assert.notEqual(prepared.cacheIdentityByChunk["session_000"], undefined);
  assert.throws(() => prepareUnifiedReconciliationJobs({ ...base(), sourceHash: "A".repeat(64) }));
  assert.throws(() => prepareUnifiedReconciliationJobs({ ...base(), alignments: [alignment(0)] }));
});

test("three-chunk context preserves independent ownership", () => {
  const prepared = prepareUnifiedReconciliationJobs(base("three"));
  assert.equal(prepared.jobs.length, 4);
  const middle = prepared.jobs[1]!.packet;
  assert.deepEqual(middle.ownedEvents.map((event) => event.text), ["event 1"]);
  assert.deepEqual(middle.context.previousReadableTail, ["event 0"]);
  assert.deepEqual(middle.context.nextAlignmentHead.map((event) => event.text), ["event 2"]);
});

test("stage uses the overnight timeout and reports needs_review without blocking", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bf-integration-stage-")); let calls = 0; let observedTimeout: number | undefined;
  const stage = await runUnifiedReconciliationStage({ ...base("three"), rootDir }, { runUnifiedReconciliation: async ({ jobs, timeoutMs }) => { calls += jobs.length; observedTimeout = timeoutMs; return { chunks: jobs.map((job) => ({ chunk: job.packet.chunk, schemaVersion: job.packet.schemaVersion, promptVersion: job.packet.promptVersion, cacheIdentity: job.packet.cacheIdentity, blocks: [{ id: "b", start: job.packet.ownedEvents[0]!.start, end: job.packet.ownedEvents[0]!.end, kind: "dialogue", text: "x", summarySafeText: "x", characterConfidence: "unknown", attributionBasis: ["source"], sourceEventIds: [job.packet.ownedEvents[0]!.id], reviewFlags: [] }], omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: "valid", errors: [] }, status: "needs_review" as const } as any)), repairedChunkIds: [], reusedChunkIds: [], diagnosticsDir: join(rootDir, "diagnostics") }; } });
  assert.equal(calls, 4); assert.equal(observedTimeout, 600_000); assert.equal(stage.status, "needs_review"); assert.equal(stage.metadata.completedChunkIds.length, 4); await rm(rootDir, { recursive: true, force: true });
});

test("stage rejects incomplete runner output and pending summary safety", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bf-integration-invalid-stage-"));
  try {
    await assert.rejects(
      () => runUnifiedReconciliationStage({ ...base("three"), rootDir }, { runUnifiedReconciliation: async ({ jobs }) => ({ chunks: [canonicalFor(jobs[0]!)], repairedChunkIds: [], reusedChunkIds: [], diagnosticsDir: join(rootDir, "diagnostics") }) }),
      /incomplete or unknown chunk set/iu,
    );
    await assert.rejects(
      () => runUnifiedReconciliationStage({ ...base("single"), rootDir }, { runUnifiedReconciliation: async ({ jobs }) => ({ chunks: jobs.map((job) => canonicalFor(job, "pending")), repairedChunkIds: [], reusedChunkIds: [], diagnosticsDir: join(rootDir, "diagnostics") }) }),
      /pending summary safety/iu,
    );
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test("structured notes calls injected summarizer and renderer, then writes MDX", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bf-integration-notes-")); let summaryCalls = 0;
  const chunk = { chunk: { id: "session_000", start: 0, end: 10 }, schemaVersion: "reconciliation.v1", promptVersion: "reconciliation.prompt.v1", cacheIdentity: {} , blocks: [{ id: "b", start: 1, end: 2, kind: "dialogue", text: "x", summarySafeText: "x", characterConfidence: "unknown", attributionBasis: ["source"], sourceEventIds: ["e"], reviewFlags: [] }], omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: "valid", errors: [] }, status: "valid" } as any;
  const job = prepareUnifiedReconciliationJobs(base("single")).jobs[0]!;
  const result = await runUnifiedStructuredNotes({ outputRoot: rootDir, chunks: [chunk], jobs: [job] }, { summarizer: async (options) => { summaryCalls++; assert.equal(options.timeoutMs, 600_000); return { chunks: [], scenes: [], session: {} as any }; }, renderer: () => "---\ntitle: Test\n---\n", writer: async (path, content) => writeFile(path, content) });
  assert.equal(summaryCalls, 1); assert.match(result.mdx, /title: Test/); await rm(rootDir, { recursive: true, force: true });
});

test("hashes files by streaming bytes", async () => { const dir = await mkdtemp(join(tmpdir(), "bf-integration-hash-")); const path = join(dir, "fixture"); await writeFile(path, "hello"); assert.equal(await hashFileSha256(path), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"); await rm(dir, { recursive: true, force: true }); });
