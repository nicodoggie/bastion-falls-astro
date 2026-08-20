import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, rename, mkdir } from "node:fs/promises";
import { basename, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { Manifest, PlannedChunk } from "./types.js";
import { AlignmentResultSchema, type AlignmentResult, type AlignmentEvent } from "./alignment.js";
import { buildEvidencePacket, type ReconciliationEvidencePacket, type ProviderIdentity } from "./reconciliationEvidence.js";
import { runUnifiedReconciliation, type ReconciliationChunkJob, type SummarySafeFallback } from "./reconciliationRunner.js";
import { runReconciliationSummarization, renderSessionMdx, runBoundedCodexCommand, type ChunkSummary, type SessionSummary, type SceneSummary, type SummarizationOptions } from "./reconciliationSummary.js";
import type { CanonicalReconciliation } from "./reconciliation.js";
import type { ReconciliationMetadata } from "./checkpoint.js";
import type { ChannelMap } from "./channelMap.js";

export type LogicalReconciliationWindow = { id: string; index: number; start: number; end: number; chunkIndices: number[] };
export type LogicalLayout = "single" | "per-stt-chunk" | "three";

function finiteWindow(start: unknown, end: unknown): [number, number] {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("logical windows must be finite and increasing");
  return [start, end];
}
function orderedChunks(manifest: Manifest): PlannedChunk[] {
  if (!manifest || !Array.isArray(manifest.chunks) || !manifest.chunks.length) throw new Error("manifest must contain chunks");
  const chunks = [...manifest.chunks].sort((a, b) => a.index - b.index);
  let previousIndex = -Infinity, previousStart = -Infinity, previousEnd = -Infinity;
  for (const chunk of chunks) { if (!Number.isInteger(chunk.index) || chunk.index < 0 || chunk.index <= previousIndex) throw new Error("manifest chunk indices must be strictly increasing"); finiteWindow(chunk.start, chunk.end); if (chunk.start < previousStart || chunk.end < previousEnd) throw new Error("manifest chunk windows are not monotonic"); previousIndex = chunk.index; previousStart = chunk.start; previousEnd = chunk.end; }
  return chunks;
}
export function buildLogicalReconciliationWindows(manifest: Manifest, layout: LogicalLayout): LogicalReconciliationWindow[] {
  const chunks = orderedChunks(manifest);
  if (!["single", "per-stt-chunk", "three"].includes(layout)) throw new Error(`unsupported logical layout: ${layout}`);
  if (layout === "single") { const start = 0; const end = manifest.durationSeconds; finiteWindow(start, end); return [{ id: "session_000", index: 0, start, end, chunkIndices: chunks.map((c) => c.index) }]; }
  if (layout === "per-stt-chunk") return chunks.map((c, index) => ({ id: `session_${String(index).padStart(3, "0")}`, index, start: c.start, end: c.end, chunkIndices: [c.index] }));
  if (chunks.length < 3) throw new Error("three-chunk context requires at least three chunks");
  return chunks.map((chunk, index) => ({ id: `session_${String(index).padStart(3, "0")}`, index, start: chunk.start, end: chunk.end, chunkIndices: [chunk.index] }));
}

export interface UnifiedJobOptions {
  manifest: Manifest; layout: LogicalLayout; alignments: readonly AlignmentResult[] | Readonly<Record<string | number, AlignmentResult>>;
  sourceHash: string; evidenceRevision: string; provider: ProviderIdentity; correctionRules?: readonly string[]; glossary?: readonly string[]; channelMap?: ChannelMap; campaign?: string; sessionDate?: string; promptVersion?: string; schemaVersion?: string; expectedCharacters?: readonly string[]; previousReadableTail?: readonly string[]; neighborLimit?: number;
}
export interface PreparedUnifiedJobs { jobs: ReconciliationChunkJob[]; cacheIdentityByChunk: Record<string, string>; windows: LogicalReconciliationWindow[] }
function alignmentFor(alignments: UnifiedJobOptions["alignments"], index: number): AlignmentResult {
  const value = Array.isArray(alignments) ? alignments[index] : (alignments as Readonly<Record<string, AlignmentResult>>)[String(index)];
  if (!value) throw new Error(`missing alignment for STT chunk ${index}`);
  return AlignmentResultSchema.parse(value);
}
function contextHead(alignment: AlignmentResult | undefined, limit: number): AlignmentEvent[] { return alignment ? alignment.events.slice(0, limit) : []; }
export function prepareUnifiedReconciliationJobs(options: UnifiedJobOptions): PreparedUnifiedJobs {
  if (!/^[a-f0-9]{64}$/.test(options.sourceHash)) throw new Error("sourceHash must be precomputed lowercase SHA-256");
  const windows = buildLogicalReconciliationWindows(options.manifest, options.layout); const chunks = orderedChunks(options.manifest); const jobs: ReconciliationChunkJob[] = [];
  for (const window of windows) {
    const owned = window.chunkIndices.flatMap((index) => alignmentFor(options.alignments, index).events);
    if (!owned.length) throw new Error(`logical window ${window.id} has an empty owned event universe`);
    const first = window.chunkIndices[0]!, last = window.chunkIndices.at(-1)!;
    const firstPosition = chunks.findIndex((chunk) => chunk.index === first);
    const lastPosition = chunks.findIndex((chunk) => chunk.index === last);
    const previous = firstPosition > 0 ? alignmentFor(options.alignments, chunks[firstPosition - 1]!.index) : undefined;
    const next = lastPosition >= 0 && lastPosition + 1 < chunks.length ? alignmentFor(options.alignments, chunks[lastPosition + 1]!.index) : undefined;
    const neighborLimit = options.neighborLimit ?? (options.layout === "three" ? 64 : 8);
    const derivedPreviousTail = previous?.events.slice(-neighborLimit).map((event) => event.text) ?? [];
    const alignment: AlignmentResult = { version: 1, events: owned };
    const packet = buildEvidencePacket({ sourceHash: options.sourceHash, alignment, logicalStart: window.start, logicalEnd: window.end, chunkIndex: window.index, previousReadableTail: options.previousReadableTail ?? derivedPreviousTail, nextAlignmentHead: contextHead(next, neighborLimit), neighborLimit, channelMap: options.channelMap, glossary: options.glossary, correctionRules: options.correctionRules, expectedCharacters: options.expectedCharacters, campaign: options.campaign, sessionDate: options.sessionDate, provider: options.provider, promptVersion: options.promptVersion, schemaVersion: options.schemaVersion, evidenceRevision: options.evidenceRevision });
    const ids = packet.ownedEvents.map((event) => event.id); if (new Set(ids).size !== ids.length) throw new Error(`duplicate evidence event IDs in ${window.id}`);
    jobs.push({ packet, authoritativeSourceEvents: packet.ownedEvents.map(({ id, text, start, end, confidence, supportedRange }) => ({ id, text, start, end, ...(confidence === undefined ? {} : { confidence }), ...(supportedRange ? { supportedRange } : {}) })) });
  }
  return { jobs, windows, cacheIdentityByChunk: Object.fromEntries(jobs.map((job) => [job.packet.chunk.id, job.packet.cacheIdentity.inputHash])) };
}

export interface UnifiedStageOptions extends UnifiedJobOptions { rootDir: string; profile?: string; maxTurns?: number; timeoutMs?: number; repositoryCwd?: string; resume?: boolean; force?: boolean; jobs?: readonly ReconciliationChunkJob[]; }
export interface UnifiedStageDeps { runUnifiedReconciliation?: typeof runUnifiedReconciliation; summarySafeFallback?: SummarySafeFallback; }
function defaultFallback(cwd: string): SummarySafeFallback { return async ({ blocks }) => { const scratch = await mkdtemp(join(tmpdir(), "bf-summary-safe-")); try { const result = await runBoundedCodexCommand({ prompt: ["Return JSON only: an object mapping every supplied blockId exactly once to nonempty summary-safe text.", "Neutralize only wording that blocks summarization; preserve meaning and do not add claims.", JSON.stringify(blocks.map((b) => ({ blockId: b.id, readableText: b.text, priorSummarySafeText: b.summarySafeText })))].join("\n"), cwd, scratch, timeoutMs: 30_000, maxOutputBytes: 200_000 }); return result as Record<string, string>; } finally { await rm(scratch, { recursive: true, force: true }); } }; }
export async function runUnifiedReconciliationStage(options: UnifiedStageOptions, deps: UnifiedStageDeps = {}): Promise<{ status: "valid" | "needs_review"; metadata: ReconciliationMetadata; chunks: CanonicalReconciliation[]; jobs: ReconciliationChunkJob[] }> {
  const prepared = options.jobs ? { jobs: [...options.jobs], cacheIdentityByChunk: Object.fromEntries(options.jobs.map((j) => [j.packet.chunk.id, j.packet.cacheIdentity.inputHash])), windows: buildLogicalReconciliationWindows(options.manifest, options.layout) } : prepareUnifiedReconciliationJobs(options);
  const runner = deps.runUnifiedReconciliation ?? runUnifiedReconciliation;
  const result = await runner({ rootDir: options.rootDir, jobs: prepared.jobs, profile: options.profile, maxTurns: options.maxTurns, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }), repositoryCwd: options.repositoryCwd, resume: options.resume, force: options.force, sanitizeSummarySafe: deps.summarySafeFallback ?? defaultFallback(options.repositoryCwd ?? process.cwd()) });
  const expectedIds = prepared.jobs.map((job) => job.packet.chunk.id);
  const actualIds = result.chunks.map((chunk) => chunk.chunk.id);
  if (new Set(actualIds).size !== actualIds.length || actualIds.length !== expectedIds.length || expectedIds.some((id) => !actualIds.includes(id))) throw new Error("reconciliation runner returned an incomplete or unknown chunk set");
  if (result.chunks.some((chunk) => chunk.status === "invalid")) throw new Error("invalid reconciliation cannot succeed");
  const pending = result.chunks.filter((c) => c.summarySafety.status === "pending").map((c) => c.chunk.id);
  if (pending.length) throw new Error("pending summary safety cannot complete reconciliation without an explicit bypass");
  const bypass: string[] = [];
  const status = result.chunks.some((c) => c.status === "needs_review") ? "needs_review" : "valid";
  const metadata: ReconciliationMetadata = { provider: "hermes", mode: "enabled", reconciliationDir: join(options.rootDir, "reconciliation"), reconciledTranscriptPath: join(options.rootDir, "reconciled_transcript.md"), summaryTranscriptPath: join(options.rootDir, "summary_transcript.md"), reviewQueuePath: join(options.rootDir, "reconciliation_review_queue.md"), schemaVersion: prepared.jobs[0]?.packet.schemaVersion ?? "reconciliation.v1", promptVersion: prepared.jobs[0]?.packet.promptVersion ?? "reconciliation.prompt.v1", cacheIdentityByChunk: Object.fromEntries(result.chunks.map((c) => [c.chunk.id, prepared.cacheIdentityByChunk[c.chunk.id]!])), completedChunkIds: result.chunks.map((c) => c.chunk.id), status, summarySafety: { pendingChunkIds: pending, bypassChunkIds: bypass } };
  if (metadata.status === "pending" || metadata.status === "invalid") throw new Error("invalid or pending reconciliation cannot succeed");
  return { status, metadata, chunks: result.chunks, jobs: prepared.jobs };
}

export interface UnifiedNotesOptions { outputRoot: string; chunks: readonly CanonicalReconciliation[]; jobs: readonly ReconciliationChunkJob[]; summarization?: Omit<SummarizationOptions, "outputRoot" | "chunks" | "promptVersion"> & { promptVersion?: string }; notePath?: string; }
export interface UnifiedNotesDeps { summarizer?: typeof runReconciliationSummarization; renderer?: typeof renderSessionMdx; writer?: (path: string, content: string) => Promise<void>; }
export async function runUnifiedStructuredNotes(options: UnifiedNotesOptions, deps: UnifiedNotesDeps = {}): Promise<{ mdx: string; path: string; summaries: { chunks: ChunkSummary[]; scenes: SceneSummary[]; session: SessionSummary } }> {
  if (!options.chunks.length || options.chunks.some((c) => c.status === "invalid" || c.summarySafety.status === "pending")) throw new Error("structured notes require validated canonical chunks");
  if (options.chunks.length !== options.jobs.length) throw new Error("canonical chunks/jobs mismatch");
  const chunkIds = options.chunks.map((chunk) => chunk.chunk.id);
  const jobIds = options.jobs.map((job) => job.packet.chunk.id);
  if (new Set(chunkIds).size !== chunkIds.length || chunkIds.some((id) => !jobIds.includes(id))) throw new Error("canonical chunk/job identities mismatch");
  const summarize = deps.summarizer ?? runReconciliationSummarization;
  const { promptVersion = options.chunks[0]!.promptVersion, ...summaryOptions } = options.summarization ?? {};
  const summaries = await summarize({ outputRoot: options.outputRoot, chunks: options.chunks, promptVersion, ...summaryOptions });
  const mdx = (deps.renderer ?? renderSessionMdx)(summaries.session, summaries.scenes); const path = options.notePath ?? join(options.outputRoot, "structured-notes.mdx");
  if (deps.writer) await deps.writer(path, mdx); else {
    const parent = dirname(path); await mkdir(parent, { recursive: true }); const temp = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
    try { const handle = await open(temp, "wx", 0o600); try { await handle.writeFile(mdx, "utf8"); await handle.sync(); } finally { await handle.close(); } await rename(temp, path); const directory = await open(parent, "r"); try { await directory.sync(); } finally { await directory.close(); } }
    finally { await rm(temp, { force: true }); }
  }
  return { mdx, path, summaries };
}

export function hashFileSha256(path: string): Promise<string> { return new Promise((resolve, reject) => { const hash = createHash("sha256"); const stream = createReadStream(path); stream.on("data", (chunk) => hash.update(chunk)); stream.on("error", reject); stream.on("end", () => resolve(hash.digest("hex"))); }); }
