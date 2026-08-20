import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BENCHMARK_VERSION,
  BenchmarkSafetyError,
  collectCanonicalReceipt,
  parseBenchmarkLane,
  prepareBenchmarkRun,
  prepareBenchmarkTrial,
  publishBenchmarkReport,
  readBenchmarkRunMarker,
  runBenchmark,
  BenchmarkReportSchema,
  atomicBenchmarkWrite,
} from "./reconciliationBenchmark.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-benchmark-"));
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "manifest.json"), '{"id":"synthetic"}\n');
  await writeFile(join(source, "checkpoint.json"), '{"version":3}\n');
  await writeFile(join(source, "raw_transcript.md"), "raw\n");
  await writeFile(join(source, "corrected_transcript.md"), "corrected\n");
  await writeFile(join(source, "channel-map.yml"), "version: 1\nchannels: []\n");
  await mkdir(join(source, "raw_transcription", "alignment"), { recursive: true });
  await writeFile(join(source, "raw_transcription", "alignment", "session_000.json"), "{}\n");
  return { root, source };
}
const rejectsSafety = (promise: Promise<unknown>) => assert.rejects(promise, (error: unknown) => error instanceof BenchmarkSafetyError);

test("parses exactly baseline, single, and window-3", () => {
  assert.deepEqual([parseBenchmarkLane("baseline"), parseBenchmarkLane("single"), parseBenchmarkLane("window-3")], ["baseline", "single", "window-3"]);
  assert.throws(() => parseBenchmarkLane("window-2"), BenchmarkSafetyError);
});

test("rejects trial equality, inside source, and source inside trial", async () => {
  const { root, source } = await fixture();
  await rejectsSafety(prepareBenchmarkTrial(source, source));
  const nested = join(source, "nested");
  await rejectsSafety(prepareBenchmarkTrial(source, nested));
  await assert.rejects(() => access(nested));
  await rejectsSafety(prepareBenchmarkTrial(source, root));
});

test("rejects symlink source and trial roots", async () => {
  const { root, source } = await fixture();
  const sourceLink = join(root, "source-link");
  const trial = join(root, "trial");
  await symlink(source, sourceLink);
  await symlink(join(root, "elsewhere"), trial).catch(async () => { await mkdir(join(root, "elsewhere")); await symlink(join(root, "elsewhere"), trial); });
  await rejectsSafety(prepareBenchmarkTrial(sourceLink, join(root, "safe-trial")));
  await rejectsSafety(prepareBenchmarkTrial(source, trial));
});

test("creates an owner-only marker in an absent or empty trial", async () => {
  const { root, source } = await fixture();
  const trial = join(root, "trial");
  const prepared = await prepareBenchmarkTrial(source, trial);
  const markerPath = join(prepared.trialDir, "benchmark-marker.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(marker.benchmarkVersion, BENCHMARK_VERSION);
  assert.equal((await (await import("node:fs/promises")).stat(markerPath)).mode & 0o777, 0o600);
  const empty = join(root, "empty"); await mkdir(empty);
  await prepareBenchmarkTrial(source, empty);
});

test("rejects nonempty unmarked and mismatched trial markers", async () => {
  const { root, source } = await fixture();
  const unmarked = join(root, "unmarked"); await mkdir(unmarked); await writeFile(join(unmarked, "output.txt"), "x");
  await rejectsSafety(prepareBenchmarkTrial(source, unmarked));
  const trial = join(root, "mismatch"); await prepareBenchmarkTrial(source, trial);
  await writeFile(join(trial, "benchmark-marker.json"), JSON.stringify({ kind: "reconciliation-benchmark-marker", version: 1, benchmarkVersion: "wrong", sourceReceipt: {} }));
  await rejectsSafety(prepareBenchmarkTrial(source, trial));
});

test("receipt is canonical, allowlisted, and detects mutation", async () => {
  const { source } = await fixture();
  await writeFile(join(source, "checkpoint.json"), "checkpoint\n");
  await writeFile(join(source, "corrected_transcript.md"), "corrected\n");
  await writeFile(join(source, "channel-map.yml"), "channels: []\n");
  await mkdir(join(source, "raw_transcription", "alignment"), { recursive: true });
  await writeFile(join(source, "raw_transcription", "alignment", "session_002.json"), "{}\n");
  for (const excluded of ["audio.wav", "raw-chunk-001.bin", "summary.md"]) await writeFile(join(source, excluded), "excluded\n");
  const first = await collectCanonicalReceipt(source);
  assert.deepEqual(first.entries.map((entry) => entry.path), ["channel-map.yml", "checkpoint.json", "corrected_transcript.md", "manifest.json", "raw_transcript.md", "raw_transcription/alignment/session_000.json", "raw_transcription/alignment/session_002.json"]);
  assert.equal(first.entries.every((entry) => !entry.path.includes("audio") && !entry.path.includes("summary") && !entry.path.includes("chunk")), true);
  assert.equal(first.receiptSha256, createHash("sha256").update(JSON.stringify({ version: 1, entries: first.entries })).digest("hex"));
  await writeFile(join(source, "raw_transcript.md"), "mutated\n");
  const second = await collectCanonicalReceipt(source);
  assert.notEqual(second.receiptSha256, first.receiptSha256);
  assert.notEqual(second.entries.find((entry) => entry.path === "raw_transcript.md")?.sha256, first.entries.find((entry) => entry.path === "raw_transcript.md")?.sha256);
});

test("routes isolated lanes, continues after failure, and detects source mutation", async () => {
  const { root, source } = await fixture();
  await writeFile(join(source, "corrected_transcript.md"), "approved baseline\n");
  const calls: Array<[string, string]> = [];
  try {
    const report = await runBenchmark({
      sourceDir: source,
      trialDir: join(root, "trial"),
      runId: "run-1",
      lanes: ["window-3", "baseline", "single"],
      executors: {
        baseline: async (input) => {
          calls.push([input.lane, input.layout]);
          assert.equal(await readFile(join(input.rootDir, "corrected_transcript.md"), "utf8"), "approved baseline\n");
          await assert.rejects(() => access(join(input.rootDir, "checkpoint.json")));
          return { calls: 1, artifactCount: 2, sourceEvents: 10, covered: 9, omitted: 1, attribution: { confirmed: 1, probable: 2, unknown: 3, abstention: 4 }, reviewFlags: ["flag.one"] };
        },
        single: async (input) => { calls.push([input.lane, input.layout]); throw new Error("PRIVATE /source/path secret"); },
        "window-3": async (input) => { calls.push([input.lane, input.layout]); await writeFile(join(source, "raw_transcript.md"), "mutated\n"); return { calls: 3 }; },
      },
    });
    assert.deepEqual(calls, [["baseline", "legacy"], ["single", "single"], ["window-3", "three"]]);
    assert.deepEqual(report.lanes.map(({ lane, status, errorClass }) => [lane, status, errorClass]), [["baseline", "ok", null], ["single", "failed", "execution"], ["window-3", "failed", "immutable-input"]]);
    const reportJson = await readFile(join(root, "trial", "run-1", "report.json"), "utf8");
    const reportMd = await readFile(join(root, "trial", "run-1", "report.md"), "utf8");
    BenchmarkReportSchema.parse(JSON.parse(reportJson));
    const marker = await readBenchmarkRunMarker(join(root, "trial", "run-1"), report.sourceReceipt);
    assert.deepEqual(marker.lanes, ["baseline", "single", "window-3"]);
    assert.doesNotMatch(`${reportJson}\n${reportMd}`, /PRIVATE|source\/path|secret/u);
    assert.match(reportMd, /coverage: 9\/10; omitted=1/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects invalid injected metrics without allowing security-field overrides", async () => {
  const { root, source } = await fixture();
  try {
    const report = await runBenchmark({ sourceDir: source, trialDir: join(root, "trial"), runId: "invalid", lanes: ["single"], executors: {
      baseline: async () => undefined,
      single: async () => ({ lane: "baseline", status: "ok", calls: -1, errorClass: null }),
      "window-3": async () => undefined,
    } });
    assert.equal(report.lanes[0]!.lane, "single");
    assert.equal(report.lanes[0]!.status, "failed");
    assert.equal(report.lanes[0]!.errorClass, "invalid-result");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("classifies lane replacement as security even when the executor throws", async () => {
  const { root, source } = await fixture();
  try {
    const report = await runBenchmark({ sourceDir: source, trialDir: join(root, "trial"), runId: "security", lanes: ["single"], executors: {
      baseline: async () => undefined,
      single: async ({ rootDir }) => { await rm(rootDir, { recursive: true }); await symlink(source, rootDir); throw new Error("ordinary failure"); },
      "window-3": async () => undefined,
    } });
    assert.equal(report.lanes[0]!.errorClass, "security");
    assert.equal(report.lanes[0]!.errorMessage, "lane root security violation");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run roots and atomic reports fail closed without replacing prior bytes", async () => {
  const { root, source } = await fixture();
  const trial = join(root, "trial");
  try {
    const prepared = await prepareBenchmarkTrial(source, trial);
    await prepareBenchmarkRun(prepared.trialDir, "owned");
    await rejectsSafety(prepareBenchmarkRun(prepared.trialDir, "owned"));
    const target = join(prepared.trialDir, "report.json");
    await writeFile(target, "prior\n");
    await assert.rejects(() => atomicBenchmarkWrite(target, "replacement\n", { beforeRename: () => { throw new Error("interrupted"); } }), /interrupted/u);
    assert.equal(await readFile(target, "utf8"), "prior\n");
    assert.deepEqual((await readdir(prepared.trialDir)).filter((name) => name.includes(".tmp-")), []);

    const pairReport = await runBenchmark({ sourceDir: source, trialDir: prepared.trialDir, runId: "pair", lanes: ["baseline"], executors: {
      baseline: async () => ({ artifactCount: 1 }), single: async () => undefined, "window-3": async () => undefined,
    } });
    const pairRoot = join(prepared.trialDir, "pair");
    await writeFile(join(pairRoot, "report.json"), "prior-json\n");
    await writeFile(join(pairRoot, "report.md"), "prior-md\n");
    await assert.rejects(() => publishBenchmarkReport(pairRoot, pairReport, { beforeRename: (name) => { if (name === "report.md") throw new Error("markdown interrupted"); } }), /markdown interrupted/u);
    assert.equal(await readFile(join(pairRoot, "report.json"), "utf8"), "prior-json\n");
    assert.equal(await readFile(join(pairRoot, "report.md"), "utf8"), "prior-md\n");
    assert.deepEqual((await readdir(pairRoot)).filter((name) => name.includes(".tmp") || name.includes(".backup")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
