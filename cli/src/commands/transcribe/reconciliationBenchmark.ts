import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const BENCHMARK_VERSION = "reconciliation-benchmark-v1" as const;
export const MARKER_FILE = "benchmark-marker.json" as const;
export const BENCHMARK_LANES = ["baseline", "single", "window-3"] as const;
export type BenchmarkLane = (typeof BENCHMARK_LANES)[number];

/** Parse the only lanes supported by the custody contract. */
export function parseBenchmarkLane(value: string): BenchmarkLane {
  if ((BENCHMARK_LANES as readonly string[]).includes(value)) return value as BenchmarkLane;
  throw new BenchmarkSafetyError(`unknown benchmark lane: ${value}`);
}
export const parseLane = parseBenchmarkLane;
export const BenchmarkLaneSchema = z.enum(BENCHMARK_LANES);

export interface BenchmarkReceiptEntry {
  path: string;
  size: number;
  sha256: string;
}
export interface BenchmarkReceipt {
  version: 1;
  entries: BenchmarkReceiptEntry[];
  receiptSha256: string;
}
export interface BenchmarkMarker {
  kind: "reconciliation-benchmark-marker";
  version: 1;
  benchmarkVersion: typeof BENCHMARK_VERSION;
  sourceReceipt: BenchmarkReceipt;
}

export class BenchmarkSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkSafetyError";
  }
}

function isContained(root: string, candidate: string): boolean {
  const r = relative(root, candidate);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);
}

/** Absolute, non-symlink directory identity used for every custody boundary. */
export async function validateRoot(input: string, label: "source" | "trial"): Promise<string> {
  if (!isAbsolute(input)) throw new BenchmarkSafetyError(`${label} root must be absolute`);
  const absolute = resolve(input);
  let entry;
  try {
    entry = await lstat(absolute);
  } catch (error) {
    throw new BenchmarkSafetyError(`${label} root does not exist`);
  }
  if (entry.isSymbolicLink()) throw new BenchmarkSafetyError(`${label} root must not be a symlink`);
  if (!entry.isDirectory()) throw new BenchmarkSafetyError(`${label} root must be a directory`);
  const canonical = await realpath(absolute);
  if (canonical !== absolute) throw new BenchmarkSafetyError(`${label} root resolves through a symlink`);
  return canonical;
}

export async function prepareBenchmarkSource(sourceRoot: string): Promise<string> {
  return validateRoot(sourceRoot, "source");
}

async function prospectiveRealpath(input: string): Promise<string> {
  let cursor = resolve(input);
  const suffix: string[] = [];
  for (;;) {
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new BenchmarkSafetyError("trial root ancestor is unsafe");
      const canonical = await realpath(cursor);
      if (canonical !== cursor) throw new BenchmarkSafetyError("trial root ancestor resolves through a symlink");
      return join(canonical, ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw new BenchmarkSafetyError("trial root has no existing safe ancestor");
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

async function readMarker(path: string): Promise<BenchmarkMarker> {
  let value: unknown;
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 1_000_000) throw new Error("unsafe marker");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new Error("marker changed");
      const buffer = Buffer.allocUnsafe(info.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== info.size) throw new Error("marker size changed");
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)));
      const after = await handle.stat();
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("marker changed");
    } finally { await handle.close(); }
  } catch {
    throw new BenchmarkSafetyError("trial marker is missing or invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BenchmarkSafetyError("trial marker is invalid");
  const marker = value as Record<string, unknown>;
  if (Object.keys(marker).sort().join("\0") !== ["benchmarkVersion", "kind", "sourceReceipt", "version"].join("\0") ||
      marker["kind"] !== "reconciliation-benchmark-marker" || marker["version"] !== 1 || marker["benchmarkVersion"] !== BENCHMARK_VERSION) {
    throw new BenchmarkSafetyError("trial marker schema/version mismatch");
  }
  const receipt = marker["sourceReceipt"];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new BenchmarkSafetyError("trial marker receipt is invalid");
  const receiptRecord = receipt as Record<string, unknown>;
  if (Object.keys(receiptRecord).sort().join("\0") !== ["entries", "receiptSha256", "version"].join("\0") || receiptRecord["version"] !== 1 ||
      typeof receiptRecord["receiptSha256"] !== "string" || !Array.isArray(receiptRecord["entries"])) {
    throw new BenchmarkSafetyError("trial marker receipt is invalid");
  }
  try { return BenchmarkMarkerZodSchema.parse(marker); }
  catch { throw new BenchmarkSafetyError("trial marker schema/version mismatch"); }
}

async function atomicOwnerOnlyWrite(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${MARKER_FILE}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`);
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const handle = await open(temp, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(temp, path);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

export async function prepareBenchmarkTrial(sourceRoot: string, trialRoot: string): Promise<{ sourceDir: string; trialDir: string; sourceReceipt: BenchmarkReceipt }> {
  const sourceDir = await validateRoot(sourceRoot, "source");
  if (!isAbsolute(trialRoot)) throw new BenchmarkSafetyError("trial root must be absolute");
  const requested = resolve(trialRoot);
  let existed = true;
  try { await lstat(requested); } catch { existed = false; }
  const prospective = existed ? await validateRoot(requested, "trial") : await prospectiveRealpath(requested);
  if (overlaps(sourceDir, prospective)) throw new BenchmarkSafetyError("source and trial roots overlap");
  if (!existed) await mkdir(requested, { recursive: true });
  const trialDir = await validateRoot(requested, "trial");

  const sourceReceipt = await collectCanonicalReceipt(sourceDir);
  const names = await readdir(trialDir);
  const markerPath = join(trialDir, MARKER_FILE);
  const hasMarker = names.includes(MARKER_FILE);
  const otherEntries = names.filter((name) => name !== MARKER_FILE);
  if (hasMarker) {
    const marker = await readMarker(markerPath);
    if (JSON.stringify(marker.sourceReceipt) !== JSON.stringify(sourceReceipt)) throw new BenchmarkSafetyError("trial marker does not match source receipt");
  } else if (otherEntries.length > 0) {
    throw new BenchmarkSafetyError("nonempty trial root has no marker");
  } else {
    const marker: BenchmarkMarker = { kind: "reconciliation-benchmark-marker", version: 1, benchmarkVersion: BENCHMARK_VERSION, sourceReceipt };
    await atomicOwnerOnlyWrite(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  }
  return { sourceDir, trialDir, sourceReceipt };
}

const ROOT_ALLOWLIST = new Set(["manifest.json", "checkpoint.json", "raw_transcript.md", "corrected_transcript.md", "channel-map.yml"]);
const REQUIRED_ROOT_INPUTS = ["manifest.json", "checkpoint.json", "raw_transcript.md", "corrected_transcript.md", "channel-map.yml"] as const;
const NESTED_ALLOWLIST = /^raw_transcription\/alignment\/session_[0-9]{3}\.json$/;
const MAX_RECEIPT_FILE_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;

async function digestContainedRegular(root: string, path: string): Promise<BenchmarkReceiptEntry> {
  const canonicalPath = resolve(path);
  if (!isContained(root, canonicalPath)) throw new BenchmarkSafetyError("receipt path escapes root");
  const info = await lstat(canonicalPath);
  if (info.isSymbolicLink() || !info.isFile()) throw new BenchmarkSafetyError("receipt entry is not a regular file");
  if (info.size > MAX_RECEIPT_FILE_BYTES) throw new BenchmarkSafetyError("receipt entry exceeds size limit");
  const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash("sha256");
  let size = 0;
  try {
    const opened = await handle.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new BenchmarkSafetyError("receipt entry changed before read");
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      size += bytesRead;
      if (size > MAX_RECEIPT_FILE_BYTES) throw new BenchmarkSafetyError("receipt entry exceeds runtime size limit");
    }
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new BenchmarkSafetyError("receipt entry changed during read");
  } finally { await handle.close(); }
  return { path: relative(root, canonicalPath).split(sep).join("/"), size, sha256: hash.digest("hex") };
}

/** Collect only canonical transcript metadata, never audio/chunks/summaries. */
export async function collectCanonicalReceipt(rootRoot: string): Promise<BenchmarkReceipt> {
  const root = await validateRoot(rootRoot, "source");
  const paths: string[] = [];
  for (const name of ROOT_ALLOWLIST) {
    const path = join(root, name);
    try { const info = await lstat(path); if (info.isSymbolicLink()) throw new BenchmarkSafetyError("receipt entry is a symlink"); if (info.isFile()) paths.push(name); } catch (error) { if (error instanceof BenchmarkSafetyError) throw error; }
  }
  for (const path of ["raw_transcription", "raw_transcription/alignment"] as const) {
    const directory = join(root, path);
    try {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new BenchmarkSafetyError("receipt directory is invalid");
      for (const name of await readdir(directory)) if (NESTED_ALLOWLIST.test(`${path}/${name}`)) paths.push(`${path}/${name}`);
    } catch (error) { if (error instanceof BenchmarkSafetyError) throw error; }
  }
  paths.sort();
  for (const required of REQUIRED_ROOT_INPUTS) if (!paths.includes(required)) throw new BenchmarkSafetyError("canonical receipt is missing a required input");
  if (!paths.some((path) => NESTED_ALLOWLIST.test(path))) throw new BenchmarkSafetyError("canonical receipt is missing alignment inputs");
  const entries = await Promise.all(paths.map((path) => digestContainedRegular(root, join(root, path))));
  const canonical = JSON.stringify({ version: 1, entries });
  return { version: 1, entries, receiptSha256: createHash("sha256").update(canonical).digest("hex") };
}
export const collectBenchmarkReceipt = collectCanonicalReceipt;

const IsoDate = z.string().datetime({ offset: true });
const NullableCount = z.number().int().nonnegative().max(10_000_000).nullable();
const Ratio = z.number().finite().nonnegative().max(1_000_000).nullable();
const Attribution = z.object({ confirmed: z.number().int().nonnegative().max(10_000_000), probable: z.number().int().nonnegative().max(10_000_000), unknown: z.number().int().nonnegative().max(10_000_000), abstention: z.number().int().nonnegative().max(10_000_000) }).strict();
const ReviewFlag = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
export const BenchmarkReceiptSchema = z.object({ version: z.literal(1), entries: z.array(z.object({ path: z.string().min(1).max(240).regex(/^[A-Za-z0-9._/-]+$/), size: z.number().int().nonnegative().max(MAX_RECEIPT_FILE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(256), receiptSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const BenchmarkMarkerZodSchema = z.object({ kind: z.literal("reconciliation-benchmark-marker"), version: z.literal(1), benchmarkVersion: z.literal(BENCHMARK_VERSION), sourceReceipt: BenchmarkReceiptSchema }).strict();
export const BenchmarkRunMarkerSchema = z.object({
  kind: z.literal("reconciliation-benchmark-run"), version: z.literal(1), benchmarkVersion: z.literal(BENCHMARK_VERSION),
  runId: z.string().regex(/^[A-Za-z0-9._-]+$/).max(80), lanes: z.array(BenchmarkLaneSchema).min(1).max(BENCHMARK_LANES.length), sourceReceipt: BenchmarkReceiptSchema,
}).strict().superRefine((marker, ctx) => {
  const expected = BENCHMARK_LANES.filter((lane) => marker.lanes.includes(lane));
  if (new Set(marker.lanes).size !== marker.lanes.length || marker.lanes.some((lane, index) => lane !== expected[index])) ctx.addIssue({ code: "custom", path: ["lanes"], message: "run marker lanes must be distinct and canonical" });
});
const LaneResultSchema = z.object({
  lane: z.enum(BENCHMARK_LANES), status: z.enum(["ok", "failed"]), startedAt: IsoDate, completedAt: IsoDate,
  runtimeMs: z.number().int().nonnegative().max(86_400_000), calls: NullableCount, retries: NullableCount,
  inputTokens: NullableCount, outputTokens: NullableCount, totalTokens: NullableCount,
  artifactCount: z.number().int().nonnegative().max(10_000_000), sourceEvents: z.number().int().nonnegative().max(10_000_000),
  covered: z.number().int().nonnegative().max(10_000_000), omitted: z.number().int().nonnegative().max(10_000_000),
  readableCompressionRatio: Ratio, summaryCompressionRatio: Ratio, overlapCount: z.number().int().nonnegative().max(10_000_000),
  attribution: Attribution, reviewFlags: z.array(ReviewFlag).max(32), receiptEqual: z.boolean(),
  errorClass: z.enum(["execution", "immutable-input", "invalid-result", "security"]).nullable(), errorMessage: z.literal("lane execution failed").or(z.literal("source receipt changed")).or(z.literal("lane result invalid")).or(z.literal("lane root security violation")).nullable(),
}).strict();
const BenchmarkReportBaseSchema = z.object({ kind: z.literal("reconciliation-benchmark-report"), version: z.literal(1), benchmarkVersion: z.literal(BENCHMARK_VERSION), runId: z.string().regex(/^[A-Za-z0-9._-]+$/).max(80), sourceReceipt: BenchmarkReceiptSchema, lanes: z.array(LaneResultSchema).min(1).max(BENCHMARK_LANES.length) }).strict();
export const BenchmarkReportSchema = BenchmarkReportBaseSchema.superRefine((report, ctx) => { const seen = new Set<string>(); const expected = BENCHMARK_LANES.filter((l) => report.lanes.some((x) => x.lane === l)); report.lanes.forEach((x, i) => { if (seen.has(x.lane)) ctx.addIssue({ code: "custom", path: ["lanes", i, "lane"], message: "duplicate lane" }); seen.add(x.lane); if (x.lane !== expected[i]) ctx.addIssue({ code: "custom", path: ["lanes", i, "lane"], message: "lanes must use canonical order" }); }); });
export type BenchmarkLaneResult = z.infer<typeof LaneResultSchema>;
export type BenchmarkReport = z.infer<typeof BenchmarkReportSchema>;

export async function prepareBenchmarkRun(trialRoot: string, runId: string): Promise<{ runDir: string; lanes: Record<BenchmarkLane, string> }> {
  const trial = await validateRoot(trialRoot, "trial");
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId.length > 80) throw new BenchmarkSafetyError("invalid run id");
  const runDir = join(trial, runId);
  try { const info = await lstat(runDir); if (info.isSymbolicLink() || !info.isDirectory()) throw new BenchmarkSafetyError("run root is unsafe"); throw new BenchmarkSafetyError("run root already exists"); } catch (error) { if (error instanceof BenchmarkSafetyError) throw error; }
  await mkdir(runDir, { recursive: false, mode: 0o700 });
  const lanes = {} as Record<BenchmarkLane, string>;
  for (const lane of BENCHMARK_LANES) { lanes[lane] = join(runDir, lane); await mkdir(lanes[lane], { mode: 0o700 }); }
  return { runDir, lanes };
}

export async function readBenchmarkRunMarker(runRoot: string, expectedReceipt: BenchmarkReceipt) {
  const root = await validateRoot(runRoot, "trial");
  const path = join(root, "run-marker.json");
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 1_000_000) throw new Error("unsafe run marker");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let value: unknown;
    try {
      const opened = await handle.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new Error("run marker changed");
      const buffer = Buffer.allocUnsafe(info.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== info.size) throw new Error("run marker size changed");
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)));
      const after = await handle.stat();
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("run marker changed");
    } finally { await handle.close(); }
    const marker = BenchmarkRunMarkerSchema.parse(value);
    if (JSON.stringify(marker.sourceReceipt) !== JSON.stringify(BenchmarkReceiptSchema.parse(expectedReceipt))) throw new Error("receipt mismatch");
    return marker;
  } catch { throw new BenchmarkSafetyError("run marker is missing, invalid, or source-mismatched"); }
}

export type BenchmarkExecutor = (input: { lane: BenchmarkLane; rootDir: string; sourceDir: string; layout: "legacy" | "single" | "three" }) => Promise<unknown>;

const emptyLane = (lane: BenchmarkLane, startedAt: string): BenchmarkLaneResult => ({ lane, status: "ok", startedAt, completedAt: startedAt, runtimeMs: 0, calls: null, retries: null, inputTokens: null, outputTokens: null, totalTokens: null, artifactCount: 0, sourceEvents: 0, covered: 0, omitted: 0, readableCompressionRatio: null, summaryCompressionRatio: null, overlapCount: 0, attribution: { confirmed: 0, probable: 0, unknown: 0, abstention: 0 }, reviewFlags: [], receiptEqual: true, errorClass: null, errorMessage: null });

async function snapshotCorrectedTranscript(sourceDir: string, destination: string): Promise<void> {
  const source = join(sourceDir, "corrected_transcript.md");
  let info;
  try { info = await lstat(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_RECEIPT_FILE_BYTES) throw new BenchmarkSafetyError("corrected transcript source is unsafe");
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output;
  try {
    const opened = await input.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new BenchmarkSafetyError("corrected transcript changed before snapshot");
    output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      await output.write(buffer, 0, bytesRead, position);
      position += bytesRead;
      if (position > MAX_RECEIPT_FILE_BYTES) throw new BenchmarkSafetyError("corrected transcript exceeds snapshot bound");
    }
    await output.sync();
    const after = await input.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new BenchmarkSafetyError("corrected transcript changed during snapshot");
  } finally {
    if (output) await output.close();
    await input.close();
  }
}

function safeMetrics(value: unknown, lane: BenchmarkLane, startedAt: string, completedAt: string): BenchmarkLaneResult {
  const base = emptyLane(lane, startedAt); base.completedAt = completedAt; base.runtimeMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const candidate = value as Record<string, unknown>; const allowed = new Set(Object.keys(base));
  for (const [key, val] of Object.entries(candidate)) if (allowed.has(key) && !["lane", "status", "startedAt", "completedAt", "runtimeMs", "receiptEqual", "errorClass", "errorMessage"].includes(key)) (base as unknown as Record<string, unknown>)[key] = val;
  return base;
}

export async function runBenchmark(options: { sourceDir: string; trialDir: string; runId: string; lanes?: readonly BenchmarkLane[]; executors: Record<BenchmarkLane, BenchmarkExecutor> }): Promise<BenchmarkReport> {
  const selected = options.lanes ?? BENCHMARK_LANES;
  if (!selected.length || new Set(selected).size !== selected.length || selected.some((lane) => !BENCHMARK_LANES.includes(lane))) throw new BenchmarkSafetyError("lanes must be distinct and bounded");
  const requested = BENCHMARK_LANES.filter((lane) => selected.includes(lane));
  const prepared = await prepareBenchmarkTrial(options.sourceDir, options.trialDir); const run = await prepareBenchmarkRun(prepared.trialDir, options.runId); const lanes: BenchmarkLaneResult[] = [];
  const runMarker = BenchmarkRunMarkerSchema.parse({ kind: "reconciliation-benchmark-run", version: 1, benchmarkVersion: BENCHMARK_VERSION, runId: options.runId, lanes: requested, sourceReceipt: prepared.sourceReceipt });
  await atomicOwnerOnlyWrite(join(run.runDir, "run-marker.json"), `${JSON.stringify(runMarker, null, 2)}\n`);
  for (const lane of requested) {
    const started = new Date(); const startedAt = started.toISOString(); const before = await collectCanonicalReceipt(prepared.sourceDir); let result: BenchmarkLaneResult; let failure: "execution" | "immutable-input" | "invalid-result" | "security" | null = null;
    try {
      if (lane === "baseline") await snapshotCorrectedTranscript(prepared.sourceDir, join(run.lanes[lane], "corrected_transcript.md"));
      const injected = await options.executors[lane]({ lane, rootDir: run.lanes[lane], sourceDir: prepared.sourceDir, layout: lane === "baseline" ? "legacy" : lane === "single" ? "single" : "three" });
      const completedAt = new Date().toISOString(); result = safeMetrics(injected, lane, startedAt, completedAt); const parsed = LaneResultSchema.safeParse(result); if (!parsed.success || result.artifactCount === 0) { failure = "invalid-result"; result = emptyLane(lane, startedAt); result.completedAt = completedAt; }
    } catch (error) { failure = error instanceof BenchmarkSafetyError ? "security" : "execution"; result = emptyLane(lane, startedAt); result.completedAt = new Date().toISOString(); }
    try { if (await validateRoot(run.lanes[lane], "trial") !== run.lanes[lane]) throw new BenchmarkSafetyError("lane root security violation"); }
    catch { failure = "security"; }
    let after: BenchmarkReceipt;
    try { after = await collectCanonicalReceipt(prepared.sourceDir); } catch { after = before; failure = "immutable-input"; }
    result.receiptEqual = failure === "immutable-input" ? false : JSON.stringify(before) === JSON.stringify(after);
    if (!result.receiptEqual) failure = "immutable-input";
    result.status = failure ? "failed" : "ok"; result.errorClass = failure; result.errorMessage = failure === "execution" ? "lane execution failed" : failure === "immutable-input" ? "source receipt changed" : failure === "invalid-result" ? "lane result invalid" : failure === "security" ? "lane root security violation" : null; lanes.push(result);
  }
  const report = BenchmarkReportSchema.parse({ kind: "reconciliation-benchmark-report", version: 1, benchmarkVersion: BENCHMARK_VERSION, runId: options.runId, sourceReceipt: prepared.sourceReceipt, lanes });
  await publishBenchmarkReport(run.runDir, report); return report;
}
export const orchestrateBenchmark = runBenchmark;
export const runImmutableBenchmark = runBenchmark;

export async function atomicBenchmarkWrite(path: string, content: string, options: { beforeRename?: () => void | Promise<void> } = {}): Promise<void> {
  const parent = dirname(path); const temp = join(parent, `.${basename(path)}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`);
  try { await writeFile(temp, content, { flag: "wx", mode: 0o600 }); const file = await open(temp, constants.O_RDONLY | constants.O_NOFOLLOW); try { await file.sync(); } finally { await file.close(); } await options.beforeRename?.(); await rename(temp, path); const dir = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY); try { await dir.sync(); } finally { await dir.close(); } } finally { await rm(temp, { force: true }).catch(() => undefined); }
}

export async function publishBenchmarkReport(runRoot: string, report: BenchmarkReport, options: { beforeRename?: (name: "report.json" | "report.md") => void | Promise<void> } = {}): Promise<void> {
  const root = await validateRoot(runRoot, "trial");
  const parsed = BenchmarkReportSchema.parse(report);
  const bodies = {
    "report.json": `${JSON.stringify(parsed, null, 2)}\n`,
    "report.md": `# Reconciliation benchmark ${parsed.runId}\n\n${parsed.lanes.map((lane) => [`## ${lane.lane}: ${lane.status}`, `- runtimeMs: ${lane.runtimeMs}`, `- calls/retries: ${lane.calls ?? "n/a"}/${lane.retries ?? "n/a"}`, `- tokens: ${lane.inputTokens ?? "n/a"}/${lane.outputTokens ?? "n/a"}/${lane.totalTokens ?? "n/a"}`, `- artifacts: ${lane.artifactCount}`, `- coverage: ${lane.covered}/${lane.sourceEvents}; omitted=${lane.omitted}`, `- compression readable/summary: ${lane.readableCompressionRatio ?? "n/a"}/${lane.summaryCompressionRatio ?? "n/a"}`, `- overlap: ${lane.overlapCount}`, `- attribution confirmed/probable/unknown/abstention: ${lane.attribution.confirmed}/${lane.attribution.probable}/${lane.attribution.unknown}/${lane.attribution.abstention}`, `- reviewFlags: ${lane.reviewFlags.join(",") || "none"}`, `- immutableReceipt: ${lane.receiptEqual ? "equal" : "changed"}`, ...(lane.errorClass ? [`- error: ${lane.errorClass} (${lane.errorMessage})`] : [])].join("\n")).join("\n\n")}\n`,
  } as const;
  const names = ["report.json", "report.md"] as const;
  const token = randomUUID();
  const temps = Object.fromEntries(names.map((name) => [name, join(root, `.${name}.${token}.tmp`)])) as Record<(typeof names)[number], string>;
  const backups = Object.fromEntries(names.map((name) => [name, join(root, `.${name}.${token}.backup`)])) as Record<(typeof names)[number], string>;
  const backedUp = new Set<(typeof names)[number]>(), published = new Set<(typeof names)[number]>();
  let committed = false;
  try {
    for (const name of names) {
      const file = await open(temps[name], constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(bodies[name], "utf8"); await file.sync(); } finally { await file.close(); }
    }
    for (const name of names) {
      try { await rename(join(root, name), backups[name]); backedUp.add(name); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    for (const name of names) {
      await options.beforeRename?.(name);
      await rename(temps[name], join(root, name));
      published.add(name);
    }
    const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
    committed = true;
  } catch (error) {
    let rollbackIncomplete = false;
    for (const name of published) {
      try { await rm(join(root, name), { force: true }); } catch { rollbackIncomplete = true; }
    }
    for (const name of backedUp) {
      try { await rename(backups[name], join(root, name)); } catch { rollbackIncomplete = true; }
    }
    try {
      const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { rollbackIncomplete = true; }
    void rollbackIncomplete;
    throw error;
  } finally {
    // Cleanup is invocation-owned and must never replace the publication error.
    for (const name of names) await rm(temps[name], { force: true }).catch(() => undefined);
  }
  if (committed) for (const name of backedUp) await rm(backups[name], { force: true }).catch(() => undefined);
}
