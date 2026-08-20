import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { buildLogicalReconciliationWindows, prepareUnifiedReconciliationJobs, runUnifiedReconciliationStage, runUnifiedStructuredNotes, hashFileSha256 } from "./reconciliationIntegration.js";

const manifest = (count = 4) => ({ version: 2, durationSeconds: count * 10, chunks: Array.from({ length: count }, (_, index) => ({ index, start: index * 10, end: (index + 1) * 10 })) }) as any;
const alignment = (i: number) => ({ version: 1 as const, events: [{ text: `event ${i}`, sourcePass: "stereo", globalStart: i * 10 + 1, globalEnd: i * 10 + 2, alternatives: [] }] });
const base = (layout: "single" | "per-stt-chunk" | "three" = "per-stt-chunk") => ({ manifest: manifest(), layout, alignments: [0, 1, 2, 3].map(alignment), sourceHash: "a".repeat(64), evidenceRevision: "rev-1", provider: { provider: "hermes", model: "test", profile: "default" } });
const canonicalFor = (job: ReturnType<typeof prepareUnifiedReconciliationJobs>["jobs"][number], summaryStatus: "valid" | "pending" = "valid") => ({ chunk: job.packet.chunk, schemaVersion: job.packet.schemaVersion, promptVersion: job.packet.promptVersion, cacheIdentity: job.packet.cacheIdentity, blocks: [{ id: "b", start: job.packet.ownedEvents[0]!.start, end: job.packet.ownedEvents[0]!.end, kind: "dialogue", text: "x", summarySafeText: summaryStatus === "valid" ? "x" : "", characterConfidence: "unknown", attributionBasis: ["source"], sourceEventIds: [job.packet.ownedEvents[0]!.id], reviewFlags: [] }], omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: summaryStatus, errors: summaryStatus === "valid" ? [] : ["pending"] }, status: "valid" as const } as any);

test("builds single, per-chunk, and independently owned three-chunk-context windows", () => {
  assert.deepEqual(buildLogicalReconciliationWindows(manifest(), "single")[0], { id: "session_000", index: 0, start: 0, end: 40, chunkIndices: [0, 1, 2, 3] });
  assert.equal(buildLogicalReconciliationWindows(manifest(), "per-stt-chunk").length, 4);
  assert.deepEqual(buildLogicalReconciliationWindows(manifest(), "three").map((x) => x.chunkIndices), [[0], [1], [2], [3]]);
  assert.throws(() => buildLogicalReconciliationWindows(manifest(2), "three"));
  assert.throws(() => buildLogicalReconciliationWindows({ ...manifest(), durationSeconds: Number.NaN } as any, "single"));
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

test("stage invokes injected runner once and reports needs_review without blocking", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bf-integration-stage-")); let calls = 0;
  const stage = await runUnifiedReconciliationStage({ ...base("three"), rootDir }, { runUnifiedReconciliation: async ({ jobs }) => { calls += jobs.length; return { chunks: jobs.map((job) => ({ chunk: job.packet.chunk, schemaVersion: job.packet.schemaVersion, promptVersion: job.packet.promptVersion, cacheIdentity: job.packet.cacheIdentity, blocks: [{ id: "b", start: job.packet.ownedEvents[0]!.start, end: job.packet.ownedEvents[0]!.end, kind: "dialogue", text: "x", summarySafeText: "x", characterConfidence: "unknown", attributionBasis: ["source"], sourceEventIds: [job.packet.ownedEvents[0]!.id], reviewFlags: [] }], omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: "valid", errors: [] }, status: "needs_review" as const } as any)), repairedChunkIds: [], reusedChunkIds: [], diagnosticsDir: join(rootDir, "diagnostics") }; } });
  assert.equal(calls, 4); assert.equal(stage.status, "needs_review"); assert.equal(stage.metadata.completedChunkIds.length, 4); await rm(rootDir, { recursive: true, force: true });
});

test("stage rejects incomplete runner output and pending summary safety", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bf-integration-invalid-stage-"));
  try {
    await assert.rejects(
      () => runUnifiedReconciliationStage({ ...base("three"), rootDir }, { runUnifiedReconciliation: async ({ jobs }) => ({ chunks: [canonicalFor(jobs[0]!)], repairedChunkIds: [], reusedChunkIds: [], diagnosticsDir: join(rootDir, "diagnostics") }) }),
      /incomplete or unknown chunk set/iu,
    );
    await assert.rejects(
      () => runUnifiedReconciliationStage({ ...base("single"), rootDir }, { runUnifiedReconciliation: async ({ jobs }) => ({ chunks: [canonicalFor(jobs[0]!, "pending")], repairedChunkIds: [], reusedChunkIds: [], diagnosticsDir: join(rootDir, "diagnostics") }) }),
      /pending summary safety/iu,
    );
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test("structured notes calls injected summarizer and renderer, then writes MDX", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bf-integration-notes-")); let summaryCalls = 0;
  const chunk = { chunk: { id: "session_000", start: 0, end: 10 }, schemaVersion: "reconciliation.v1", promptVersion: "reconciliation.prompt.v1", cacheIdentity: {} , blocks: [{ id: "b", start: 1, end: 2, kind: "dialogue", text: "x", summarySafeText: "x", characterConfidence: "unknown", attributionBasis: ["source"], sourceEventIds: ["e"], reviewFlags: [] }], omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: "valid", errors: [] }, status: "valid" } as any;
  const job = prepareUnifiedReconciliationJobs(base("single")).jobs[0]!;
  const result = await runUnifiedStructuredNotes({ outputRoot: rootDir, chunks: [chunk], jobs: [job] }, { summarizer: async () => { summaryCalls++; return { chunks: [], scenes: [], session: {} as any }; }, renderer: () => "---\ntitle: Test\n---\n", writer: async (path, content) => writeFile(path, content) });
  assert.equal(summaryCalls, 1); assert.match(result.mdx, /title: Test/); await rm(rootDir, { recursive: true, force: true });
});

test("hashes files by streaming bytes", async () => { const dir = await mkdtemp(join(tmpdir(), "bf-integration-hash-")); const path = join(dir, "fixture"); await writeFile(path, "hello"); assert.equal(await hashFileSha256(path), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"); await rm(dir, { recursive: true, force: true }); });
