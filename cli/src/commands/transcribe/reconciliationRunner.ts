import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  parseCanonicalReconciliation,
  parseReconciliationResponse,
  validateReconciliation,
  type CanonicalReconciliation,
  type ReconciliationResponse,
  type ReconciliationBlock,
  type SourceEvent,
} from "./reconciliation.js";
import type { ReconciliationEvidencePacket } from "./reconciliationEvidence.js";
import { renderPrivateReconciliation, renderSummaryReconciliation, renderReconciliationReviewQueue } from "./reconciliationRender.js";

export interface ReconciliationChunkJob { packet: ReconciliationEvidencePacket; authoritativeSourceEvents: readonly SourceEvent[] }
export interface InvocationResult { stdout: string; stderr?: string; metadata?: Record<string, unknown> }
export type InvokeReconciliation = (job: ReconciliationChunkJob, prompt: string, signal: AbortSignal) => Promise<InvocationResult | string>;
export type SummarySafeFallback = (input: { chunk: CanonicalReconciliation; blocks: readonly ReconciliationBlock[]; signal: AbortSignal }) => Promise<SummarySafeFallbackResult | string>;
export type SummarySafeFallbackResult = Record<string, string> | readonly { blockId: string; text: string }[];
export interface ReconciliationRunnerOptions {
  rootDir: string; jobs: readonly ReconciliationChunkJob[]; invokeReconciliation?: InvokeReconciliation;
  sanitizeSummarySafe?: SummarySafeFallback; checkpoint?: (chunk: CanonicalReconciliation) => Promise<void> | void;
  hermesCommand?: string; profile?: string; maxTurns?: number; timeoutMs?: number; maxOutputBytes?: number;
  repositoryCwd?: string;
  diagnosticWriter?: (path: string, payload: unknown) => Promise<void> | void;
  resume?: boolean; force?: boolean;
}
export interface ReconciliationRunnerResult { chunks: CanonicalReconciliation[]; repairedChunkIds: string[]; reusedChunkIds: string[]; diagnosticsDir: string }
export interface HermesArgsOptions { promptPath: string; profile?: string; maxTurns?: number; command?: string }

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2_000_000;
const DEFAULT_MAX_TURNS = 8;
const MAX_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 20_000_000;
const HERMES_INVOCATION = Symbol("hermesInvocation");
type HermesInvocationError = Error & { [HERMES_INVOCATION]: InvocationResult };

function attachHermesInvocation(error: Error, invocation: InvocationResult): HermesInvocationError {
  return Object.assign(error, { [HERMES_INVOCATION]: invocation });
}

function invocationFromError(error: unknown): InvocationResult | undefined {
  return error instanceof Error && HERMES_INVOCATION in error
    ? (error as HermesInvocationError)[HERMES_INVOCATION]
    : undefined;
}
const MAX_TURNS = 1_000;
const MAX_PROMPT_BYTES = 20_000_000;
const DEFAULT_HERMES_COMMAND = "hermes";
const HERMES_SKILLS = "bastion-transcript-evidence-workflows,bastion-note-review-corrections";
const CHUNK_ID = /^session_\d{3}$/;
const CANONICAL_CHUNK_ARTIFACT = /^session_\d{3}\.json$/;
const RECONCILIATION_OUTPUT_CONTRACT = [
  "COMPLETE OUTPUT CONTRACT (authoritative; do not search the repository for schemas or examples):",
  "Return one strict JSON object with exactly these top-level keys and no status key: schemaVersion, promptVersion, chunk, cacheIdentity, blocks, omissions, materialCorrections, suspicionFlags, reviewNotes, summarySafety.",
  "Echo schemaVersion, promptVersion, chunk, and cacheIdentity exactly from packet.",
  "blocks must be a nonempty chronological array. Each block has exactly: id, start, end, kind, text, summarySafeText, optional channel, optional physicalSpeaker, optional characterCandidate, characterConfidence, attributionBasis, sourceEventIds, reviewFlags.",
  "block kind enum: dialogue | narration | unclear. characterConfidence enum: confirmed | probable | unknown. If unknown, omit characterCandidate; otherwise characterCandidate is required.",
  "channel and physicalSpeaker may be emitted only when directly supported by supplied packet evidence. expectedCharacters are candidates only, not attribution proof. attributionBasis must cite only supplied packet evidence.",
  "After choosing sourceEventIds, derive each block start as the minimum supported start and block end as the maximum supported end across those sourceEventIds. Never use an aesthetic prose or turn boundary that excludes claimed event support. attributionBasis has 1-8 short strings. reviewFlags enum: ambiguous-speaker | unclear-words | possible-omission | attribution-uncertain | material-correction.",
  "The runner recomputes each block start and end, omission text/start/end, and materialCorrection sourceForm from authoritative source events after strict parsing. These are source echoes, not model authority; sourceEventIds and omission/correction reasons remain your decisions.",
  "omissions is an array of exact authoritative snapshots with exactly: sourceEventId, text, start, end, reason. reason enum: decoder-loop | duplicate | false-start | non-speech | unintelligible | outside-logical-window.",
  "Every authoritativeSourceEvent must appear exactly once, either in one block.sourceEventIds array or one omission.sourceEventId, never both and never neither. Context-only events must never be accounted.",
  "If a sourceEventId is duplicated, the runner keeps its first chronological block owner and removes later duplicate accounting references. A block emptied by this repair remains invalid.",
  "materialCorrections entries have exactly: sourceEventId, sourceForm, replacement, evidence. sourceForm must exactly equal the authoritative event text; evidence has 1-8 short strings grounded only in supplied packet fields or a specific read-only repository fact actually verified during this run.",
  "suspicionFlags enum: high-omitted-ratio | large-compression | decoder-loop-range | expected-character-only | unsupported-proper-noun | unexplained-silence | reordered-source-events.",
  "The suspicionFlags and reviewFlags enums are disjoint: suspicionFlags values must never appear in any block.reviewFlags array, and reviewFlags values must never appear in top-level suspicionFlags.",
  "reviewNotes is an array of at most 8 short strings.",
  "summarySafety has exactly: status, errors. status enum: valid | pending. errors is an array of at most 8 short strings. summarySafeText must correspond block-for-block; use pending only when a block cannot be made summary-safe faithfully.",
  "Every attributionBasis string, materialCorrection evidence string, reviewNotes string, and summarySafety errors string must be at most 256 characters. Rewrite concisely rather than exceeding the limit.",
  "All IDs and nonempty text fields must be bounded nonempty strings. Do not add unknown keys, Markdown, commentary, or repository-derived evidence.",
].join("\n");

export class PendingSummarySafetyError extends Error {
  readonly code = "SUMMARY_SAFETY_PENDING" as const;
  constructor(chunkId: string, options?: { cause?: unknown }) { super(`summary-safe fallback failed; canonical remains pending for ${chunkId}`, options); this.name = "PendingSummarySafetyError"; }
}

function assertBounds(timeoutMs: number, maxOutputBytes: number, maxTurns = DEFAULT_MAX_TURNS): void {
  if (![timeoutMs, maxOutputBytes, maxTurns].every((n) => Number.isSafeInteger(n) && n > 0)) throw new RangeError("bounds must be positive safe integers");
  if (timeoutMs > MAX_TIMEOUT_MS) throw new RangeError("timeoutMs exceeds maximum");
  if (maxOutputBytes > MAX_OUTPUT_BYTES) throw new RangeError("maxOutputBytes exceeds maximum");
  if (maxTurns > MAX_TURNS) throw new RangeError("maxTurns exceeds maximum");
}
function assertChunkId(id: string): void { if (!CHUNK_ID.test(id)) throw new Error(`unsafe reconciliation chunk id: ${id}`); }
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function semanticallyEqual(a: unknown, b: unknown): boolean { return createHash("sha256").update(stable(a)).digest("hex") === createHash("sha256").update(stable(b)).digest("hex"); }
function resultSize(value: InvocationResult | string | SummarySafeFallbackResult): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function oversizedPromptError(job: ReconciliationChunkJob, promptBytes: number): RangeError {
  const largestEventBytes = job.authoritativeSourceEvents.reduce((largest, event) => Math.max(largest, Buffer.byteLength(event.text, "utf8")), 0);
  return new RangeError(`prompt exceeded 20 MB bound: promptBytes=${promptBytes} authoritativeEvents=${job.authoritativeSourceEvents.length} largestEventBytes=${largestEventBytes}`);
}

export function buildUnifiedReconciliationPrompt(job: ReconciliationChunkJob): string {
  const { packet } = job;
  return ["You are performing read-only transcript reconciliation.", `Owned logical window: ${packet.chunk.id} ${packet.chunk.start}-${packet.chunk.end}.`, "Produce a readable transcript, not a narrative digest. Preserve recoverable dialogue and narration, turn structure, meaningful repetition, interruption, uncertainty, and code-switching. Merge events only when they represent the same utterance; omit only content matching an allowed omission reason.", "Only authoritativeSourceEvents in this packet may be consumed, omitted, or emitted.", "Previous readable text and next alignment events are context-only; neighboring events are forbidden.", "Use unknown attribution rather than inventing a character. Summary-safe text must correspond block-for-block.", RECONCILIATION_OUTPUT_CONTRACT, "All required schema and ownership evidence follows. Do not search the repository for schemas or output examples. Bounded read-only repository retrieval is allowed only to verify a specific uncertain proper noun or lore claim; it cannot change evidence ownership or create support absent from the supplied packet.", JSON.stringify({ packet, authoritativeSourceEvents: job.authoritativeSourceEvents }, null, 2)].join("\n");
}

export function buildHermesReconciliationArgs(options: HermesArgsOptions): string[] {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  assertBounds(DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES, maxTurns);
  if (!isAbsolute(options.promptPath) || options.promptPath.includes("\0") || /[\r\n]/u.test(options.promptPath) || Buffer.byteLength(options.promptPath, "utf8") > 4_096) throw new Error("promptPath must be a bounded absolute path");
  const query = `Read and follow the complete UTF-8 reconciliation request using the file tool: ${JSON.stringify(options.promptPath)}`;
  return [options.command ?? DEFAULT_HERMES_COMMAND, ...(options.profile ? ["--profile", options.profile] : []), "chat", "-Q", "--source", "tool", "-t", "file", "-s", HERMES_SKILLS, "--max-turns", String(maxTurns), "-q", query];
}

export function parseStrictReconciliationJson(stdout: string): unknown {
  if (typeof stdout !== "string" || stdout.trim().length === 0) throw new Error("empty reconciliation response");
  try { return JSON.parse(stdout); } catch (error) { throw new Error(`strict JSON reconciliation response rejected: ${error instanceof Error ? error.message : String(error)}`); }
}

const HERMES_MAX_TURNS_PREFIX = /^\u26a0\ufe0f {2}Reached maximum iterations \(\d+\)\. Requesting summary\.\.\.\r?\n/u;
export function parseHermesReconciliationJson(stdout: string): unknown {
  return parseStrictReconciliationJson(stdout.replace(HERMES_MAX_TURNS_PREFIX, ""));
}

export function validateReconciliationOutput(value: unknown, job: ReconciliationChunkJob): CanonicalReconciliation {
  const response = parseReconciliationResponse(value);
  assertReconciliationEchoes(response, job);
  return validateReconciliation(hydrateAuthoritativeSourceEchoes(normalizeDuplicateSourceAccounting(response), job), { authoritativeSourceEvents: job.authoritativeSourceEvents });
}

function normalizeDuplicateSourceAccounting(response: ReconciliationResponse): ReconciliationResponse {
  const seen = new Set<string>();
  const blocks = response.blocks.map((block) => ({
    ...block,
    sourceEventIds: block.sourceEventIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  }));
  const omissions = response.omissions.filter((omission) => {
    if (seen.has(omission.sourceEventId)) return false;
    seen.add(omission.sourceEventId);
    return true;
  });
  return { ...response, blocks, omissions };
}

function hydrateAuthoritativeSourceEchoes(response: ReconciliationResponse, job: ReconciliationChunkJob): ReconciliationResponse {
  const eventById = new Map(job.authoritativeSourceEvents.map((event) => [event.id, event]));
  return {
    ...response,
    blocks: response.blocks.map((block) => {
      const events = block.sourceEventIds.map((id) => eventById.get(id));
      if (events.some((event) => event === undefined)) return block;
      const authoritative = events as SourceEvent[];
      let start = Infinity, end = -Infinity;
      for (const event of authoritative) {
        start = Math.min(start, event.supportedRange?.start ?? event.start);
        end = Math.max(end, event.supportedRange?.end ?? event.end);
      }
      return {
        ...block,
        start,
        end,
      };
    }),
    omissions: response.omissions.map((omission) => {
      const event = eventById.get(omission.sourceEventId);
      return event ? { ...omission, text: event.text, start: event.start, end: event.end } : omission;
    }),
    materialCorrections: response.materialCorrections.map((correction) => {
      const event = eventById.get(correction.sourceEventId);
      return event ? { ...correction, sourceForm: event.text } : correction;
    }),
  };
}

function assertReconciliationEchoes(value: unknown, job: ReconciliationChunkJob): asserts value is Record<string, unknown> {
  const candidate = value as Record<string, unknown>;
  if (!candidate || typeof candidate !== "object") throw new Error("reconciliation output must be an object");
  if (!semanticallyEqual(candidate["chunk"], job.packet.chunk)) throw new Error("echoed chunk identity mismatch");
  if (!semanticallyEqual(candidate["cacheIdentity"], job.packet.cacheIdentity)) throw new Error("echoed cache identity mismatch");
  if (candidate["schemaVersion"] !== job.packet.schemaVersion) throw new Error("echoed schema identity mismatch");
  if (candidate["promptVersion"] !== job.packet.promptVersion) throw new Error("echoed prompt identity mismatch");
}

function terminateGroup(child: ReturnType<typeof spawn>): void { if (child.pid === undefined) return; try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} } }
function killGroup(child: ReturnType<typeof spawn>): void { if (child.pid === undefined) return; try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } }
function groupExists(child: ReturnType<typeof spawn>): boolean {
  if (child.pid === undefined) return false;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export async function boundedHermes(job: ReconciliationChunkJob, prompt: string, signal: AbortSignal, options: { timeoutMs: number; maxOutputBytes: number; hermesCommand: string; profile?: string; maxTurns: number; repositoryCwd?: string; promptDir?: string }): Promise<InvocationResult> {
  if (signal.aborted) throw new Error("reconciliation aborted");
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  if (promptBytes > MAX_PROMPT_BYTES) throw oversizedPromptError(job, promptBytes);
  assertChunkId(job.packet.chunk.id);
  const promptDir = options.promptDir ?? options.repositoryCwd ?? process.cwd();
  if (!isAbsolute(promptDir)) throw new Error("promptDir must be an absolute path");
  const promptPath = join(promptDir, `.reconciliation-prompt-${job.packet.chunk.id}-${randomUUID()}.json`);
  let completed = false;
  let promptSafeToRemove = true;
  try {
    await mkdir(promptDir, { recursive: true });
    const handle = await open(promptPath, "wx", 0o600);
    try { await handle.writeFile(prompt, "utf8"); await handle.sync(); } finally { await handle.close(); }
    const args = buildHermesReconciliationArgs({ promptPath, profile: options.profile, maxTurns: options.maxTurns, command: options.hermesCommand });
    const result = await new Promise<InvocationResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(args[0]!, args.slice(1), { stdio: ["ignore", "pipe", "pipe"], detached: true, cwd: options.repositoryCwd ?? process.cwd() }); }
    catch (error) { reject(error); return; }
    let stdout = "", stderr = "", bytes = 0, settled = false, failing = false, failureError: Error | undefined;
    const startedAt = Date.now();
    let graceTimer: ReturnType<typeof setTimeout> | undefined, finalTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => fail(new Error("Hermes timed out")), options.timeoutMs);
    const cleanup = () => { clearTimeout(timer); if (graceTimer) clearTimeout(graceTimer); if (finalTimer) clearTimeout(finalTimer); signal.removeEventListener("abort", onAbort); child.stdout?.removeListener("data", onStdout); child.stderr?.removeListener("data", onStderr); child.removeListener("error", onError); child.removeListener("close", onClose); };
    const invocation = (): InvocationResult => ({ stdout, stderr, metadata: { exitCode: child.exitCode, durationMs: Date.now() - startedAt, ...(options.profile ? { profile: options.profile } : {}) } });
    const settle = (error?: Error) => { if (settled) return; settled = true; cleanup(); error ? reject(attachHermesInvocation(error, invocation())) : resolve(invocation()); };
    const fail = (error: Error) => { if (settled || failing) return; failing = true; failureError = error; terminateGroup(child); graceTimer = setTimeout(() => { if (!groupExists(child)) { settle(error); return; } killGroup(child); finalTimer = setTimeout(() => { if (groupExists(child)) { promptSafeToRemove = false; settle(new Error(`${error.message}; Hermes process group survived SIGKILL`)); return; } settle(error); }, 250); }, 100); };
    const onStdout = (chunk: Buffer) => { if (settled) return; bytes += chunk.byteLength; if (bytes > options.maxOutputBytes) fail(new Error("Hermes output exceeded bound")); else stdout += chunk.toString("utf8"); };
    const onStderr = (chunk: Buffer) => { if (settled) return; bytes += chunk.byteLength; if (bytes > options.maxOutputBytes) fail(new Error("Hermes output exceeded bound")); else stderr += chunk.toString("utf8"); };
    const onError = (error: Error) => failing ? undefined : settle(error);
    const onAbort = () => fail(new Error("reconciliation aborted"));
    const onClose = (code: number | null, sig: NodeJS.Signals | null) => { if (failing) { if (!groupExists(child)) settle(failureError); return; } code === 0 ? settle() : settle(new Error(`Hermes exited ${code ?? sig}`)); };
    child.stdout?.on("data", onStdout); child.stderr?.on("data", onStderr); child.once("error", onError); child.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    });
    completed = true;
    return result;
  } finally {
    if (promptSafeToRemove) {
      try { await rm(promptPath); } catch (error) { if (completed) throw error; }
    }
  }
}

export async function writeReconciliationTextAtomic(targetPath: string, content: string, hooks?: { beforeRename?: () => void | Promise<void> }): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true }); const tempPath = join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`);
  try { const handle = await open(tempPath, "wx", 0o600); try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); } await hooks?.beforeRename?.(); await rename(tempPath, targetPath); const dir = await open(dirname(targetPath), "r"); try { await dir.sync(); } finally { await dir.close(); } } finally { await rm(tempPath, { force: true }); }
}

export async function writeCanonicalReconciliationAtomic(targetPath: string, value: CanonicalReconciliation, hooks?: { beforeRename?: () => void | Promise<void> }): Promise<void> {
  await writeReconciliationTextAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`, hooks);
}

async function persistDiagnostic(root: string, chunkId: string, invocation: InvocationResult | undefined, error: unknown, maxOutputBytes: number, writer?: ReconciliationRunnerOptions["diagnosticWriter"]): Promise<void> { assertChunkId(chunkId); const dir = join(root, "diagnostics"); const clip = (value: string, limit: number) => Buffer.from(value, "utf8").subarray(0, limit).toString("utf8"); const stdout = clip(invocation?.stdout ?? "", maxOutputBytes); const remaining = Math.max(0, maxOutputBytes - Buffer.byteLength(stdout, "utf8")); const stderr = clip(invocation?.stderr ?? "", remaining); const raw = invocation?.metadata ?? {}; const metadata: Record<string, unknown> = {}; for (const key of ["exitCode", "durationMs", "model", "profile", "inputTokens", "outputTokens", "totalTokens"]) if (key in raw) metadata[key] = raw[key]; const payload = { chunkId, stdout, stderr, metadata, error: clip(error instanceof Error ? error.message : String(error), Math.min(1_024, maxOutputBytes)) }; const path = join(dir, `${chunkId}-${Date.now()}-${randomUUID()}.json`); await mkdir(dir, { recursive: true, mode: 0o700 }); if (writer) await writer(path, payload); else { await chmod(dir, 0o700); await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); } }
async function bestEffortDiagnostic(options: ReconciliationRunnerOptions, chunkId: string, invocation: InvocationResult | undefined, error: unknown, maxOutputBytes: number): Promise<void> {
  try { await persistDiagnostic(options.rootDir, chunkId, invocation, error, maxOutputBytes, options.diagnosticWriter); }
  catch (diagnosticError) { if (error instanceof Error) { const note = ` (diagnostic recording failed: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)})`; error.message = `${error.message}${note.slice(0, Math.max(0, 256 - error.message.length))}`; } }
}
async function readReusable(path: string, job: ReconciliationChunkJob): Promise<CanonicalReconciliation | undefined> {
  try {
    const persisted = JSON.parse(await readFile(path, "utf8")) as unknown;
    // Resume validation must authenticate persisted status instead of silently
    // re-deriving it from a status-stripped model response.
    assertReconciliationEchoes(persisted, job);
    if (!("status" in persisted)) throw new Error("canonical artifact is missing status");
    const reusable = parseCanonicalReconciliation(persisted, { authoritativeSourceEvents: job.authoritativeSourceEvents });
    if (persisted["status"] !== reusable.status) throw new Error("canonical status disagrees with authoritative validation");
    return reusable;
  } catch { return undefined; }
}

async function boundedCall<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number, maxOutputBytes: number, label: string): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let done = false;
  const operation = call(controller.signal).then((value) => { if (resultSize(value as never) > maxOutputBytes) throw new Error(`${label} output exceeded bound`); return value; });
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(`${label} timed out`)); }, timeoutMs); });
  try { return await Promise.race([operation, timeout]); } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
function fallbackMap(value: SummarySafeFallbackResult | string, blocks: readonly ReconciliationBlock[]): Map<string, string> { const parsed = typeof value === "string" ? parseStrictReconciliationJson(value) as SummarySafeFallbackResult : value; const entries = Array.isArray(parsed) ? parsed.map((item) => [item.blockId, item.text] as const) : Object.entries(parsed); const known = new Set(blocks.map((block) => block.id)); if (entries.length !== blocks.length || new Set(entries.map(([id]) => id)).size !== blocks.length || entries.some(([id, text]) => !known.has(id) || typeof text !== "string" || !text.trim())) throw new Error("fallback must map every block ID exactly once"); return new Map(entries); }

async function maybeFallback(chunk: CanonicalReconciliation, job: ReconciliationChunkJob, options: ReconciliationRunnerOptions, path: string, timeoutMs: number, maxOutputBytes: number): Promise<CanonicalReconciliation> {
  if (chunk.summarySafety.status !== "pending") return chunk;
  const pending = { ...chunk, summarySafety: { ...chunk.summarySafety, status: "pending" as const } }; await writeCanonicalReconciliationAtomic(path, pending);
  if (!options.sanitizeSummarySafe) { const error = new PendingSummarySafetyError(job.packet.chunk.id); await bestEffortDiagnostic(options, job.packet.chunk.id, undefined, error, maxOutputBytes); throw error; }
  try { const result = await boundedCall((signal) => options.sanitizeSummarySafe!({ chunk: pending, blocks: pending.blocks, signal }), timeoutMs, maxOutputBytes, "summary-safe fallback"); const map = fallbackMap(result, pending.blocks); const updated: CanonicalReconciliation = { ...pending, blocks: pending.blocks.map((block) => ({ ...block, summarySafeText: map.get(block.id)! })), summarySafety: { status: "valid", errors: [] } }; assertReconciliationEchoes(updated, job); const reread = validateReconciliation(updated, { authoritativeSourceEvents: job.authoritativeSourceEvents }); await writeCanonicalReconciliationAtomic(path, reread); return reread; }
  catch (error) { const pendingError = new PendingSummarySafetyError(job.packet.chunk.id, { cause: error }); await bestEffortDiagnostic(options, job.packet.chunk.id, undefined, pendingError, maxOutputBytes); throw pendingError; }
}

export async function runUnifiedReconciliation(options: ReconciliationRunnerOptions): Promise<ReconciliationRunnerResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  assertBounds(timeoutMs, maxOutputBytes, maxTurns); for (const job of options.jobs) assertChunkId(job.packet.chunk.id);
  if (options.repositoryCwd !== undefined && typeof options.repositoryCwd !== "string") throw new TypeError("repositoryCwd must be a string");
  const canonicalDir = join(options.rootDir, "reconciliation"); await mkdir(canonicalDir, { recursive: true }); const chunks: CanonicalReconciliation[] = []; const reusedChunkIds: string[] = [], repairedChunkIds: string[] = [];
  if (options.resume || options.force) {
    const expectedArtifacts = new Set(options.jobs.map((job) => `${job.packet.chunk.id}.json`));
    for (const entry of await readdir(canonicalDir, { withFileTypes: true })) {
      if (entry.isFile() && CANONICAL_CHUNK_ARTIFACT.test(entry.name) && !expectedArtifacts.has(entry.name)) await rm(join(canonicalDir, entry.name));
    }
  }
  if (!options.resume && !options.force) for (const job of options.jobs) { try { await readFile(join(canonicalDir, `${job.packet.chunk.id}.json`), "utf8"); throw new Error(`canonical artifact already exists for ${job.packet.chunk.id}; use resume or force`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  for (const derivative of ["reconciled_transcript.md", "summary_transcript.md", "reconciliation_review_queue.md"]) await rm(join(options.rootDir, derivative), { force: true });
  for (const job of options.jobs) {
    const path = join(canonicalDir, `${job.packet.chunk.id}.json`); const existing = await readReusable(path, job); let artifactExists = false; try { await readFile(path, "utf8"); artifactExists = true; } catch {}
    if (artifactExists && !options.resume && !options.force) throw new Error(`canonical artifact already exists for ${job.packet.chunk.id}; use resume or force`);
    let chunk: CanonicalReconciliation | undefined = options.resume && !options.force ? existing : undefined;
    if (chunk) reusedChunkIds.push(job.packet.chunk.id);
    else { repairedChunkIds.push(job.packet.chunk.id); const prompt = buildUnifiedReconciliationPrompt(job); let invocation: InvocationResult | undefined; try { const promptBytes = Buffer.byteLength(prompt, "utf8"); if (promptBytes > MAX_PROMPT_BYTES) throw oversizedPromptError(job, promptBytes); const invoked = options.invokeReconciliation ? await boundedCall((signal) => options.invokeReconciliation!(job, prompt, signal), timeoutMs, maxOutputBytes, "reconciliation") : await boundedHermes(job, prompt, new AbortController().signal, { timeoutMs, maxOutputBytes, hermesCommand: options.hermesCommand ?? DEFAULT_HERMES_COMMAND, profile: options.profile, maxTurns, repositoryCwd: options.repositoryCwd, promptDir: options.rootDir }); invocation = typeof invoked === "string" ? { stdout: invoked } : invoked; const parsed = options.invokeReconciliation ? parseStrictReconciliationJson(invocation.stdout) : parseHermesReconciliationJson(invocation.stdout); chunk = validateReconciliationOutput(parsed, job); } catch (error) { invocation ??= invocationFromError(error); await bestEffortDiagnostic(options, job.packet.chunk.id, invocation, error, maxOutputBytes); throw error; } await persistDiagnostic(options.rootDir, job.packet.chunk.id, invocation, undefined, maxOutputBytes, options.diagnosticWriter); await writeCanonicalReconciliationAtomic(path, chunk); }
    chunk = await maybeFallback(chunk!, job, options, path, timeoutMs, maxOutputBytes); const reread = await readReusable(path, job); if (!reread) throw new Error(`canonical reread failed for ${job.packet.chunk.id}`); chunk = reread; const detached = structuredClone(chunk); chunks.push(detached); await options.checkpoint?.(structuredClone(detached));
  }
  await writeReconciliationTextAtomic(join(options.rootDir, "reconciled_transcript.md"), renderPrivateReconciliation(chunks)); if (chunks.every((item) => item.summarySafety.status === "valid")) await writeReconciliationTextAtomic(join(options.rootDir, "summary_transcript.md"), renderSummaryReconciliation(chunks)); await writeReconciliationTextAtomic(join(options.rootDir, "reconciliation_review_queue.md"), renderReconciliationReviewQueue(chunks)); return { chunks: structuredClone(chunks), repairedChunkIds, reusedChunkIds, diagnosticsDir: join(options.rootDir, "diagnostics") };
}
