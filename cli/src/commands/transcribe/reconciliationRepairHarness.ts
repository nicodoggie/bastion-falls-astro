import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { evaluateFormatRepair } from './reconciliationRepair.js';
import { allRepairFixtures, RepairFixtureSchema, type RepairFixture } from './reconciliationRepairFixtures.js';

export const PHASE_A_VERSION = 1 as const;
export const BLOCKED_REASONS = ['blocked-no-zero-tool-seam', 'blocked-no-context-isolation', 'model-identity-unproven'] as const;
export const BlockedReasonSchema = z.enum(BLOCKED_REASONS);
export type BlockedReason = z.infer<typeof BlockedReasonSchema>;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const IdentitySchema = z.object({ provider: z.string().regex(SAFE_IDENTIFIER), model: z.string().regex(SAFE_IDENTIFIER) }).strict();
const UsageSchema = z.object({
  provider: z.string().regex(SAFE_IDENTIFIER), model: z.string().regex(SAFE_IDENTIFIER),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  apiCalls: z.literal(1), toolAvailability: z.literal('none'), toolCalls: z.literal(0),
  safeMode: z.literal(true), userConfigIgnored: z.literal(true), rulesIgnored: z.literal(true), profile: z.literal('none'),
  inlinePrompt: z.literal(true), cwdIsolated: z.literal(true), environmentAllowlisted: z.literal(true),
  sessionId: z.string().regex(SAFE_IDENTIFIER),
}).strict();
const RuntimeUsageSchema = z.object({
  provider: z.string().regex(SAFE_IDENTIFIER), model: z.string().regex(SAFE_IDENTIFIER),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  apiCalls: z.number().int().nonnegative().max(1), toolAvailability: z.enum(['none', 'available']), toolCalls: z.number().int().nonnegative().max(100),
  safeMode: z.boolean(), userConfigIgnored: z.boolean(), rulesIgnored: z.boolean(), profile: z.string().regex(SAFE_IDENTIFIER),
  inlinePrompt: z.boolean(), cwdIsolated: z.boolean(), environmentAllowlisted: z.boolean(), sessionId: z.string().regex(SAFE_IDENTIFIER),
}).strict();
export interface FormatterAdapter {
  identity: z.infer<typeof IdentitySchema>;
  invoke(input: { prompt: string; timeoutMs: number; maxOutputBytes: number; scratchDir: string; signal: AbortSignal }): Promise<{ stdout: string; usage: z.infer<typeof UsageSchema> }>;
}
const MetricsSchema = z.object({
  fixtures: z.number().int().nonnegative().max(32), positives: z.number().int().nonnegative().max(32), negatives: z.number().int().nonnegative().max(32),
  positivesAccepted: z.number().int().nonnegative().max(32), negativesRefused: z.number().int().nonnegative().max(32),
  positiveAcceptancePercent: z.number().finite().min(0).max(100), negativeRefusalPercent: z.number().finite().min(0).max(100),
  apiCalls: z.number().int().nonnegative().max(10000), toolCalls: z.literal(0),
}).strict();
const ModelResultBase = z.object({ provider: z.string().regex(SAFE_IDENTIFIER), model: z.string().regex(SAFE_IDENTIFIER), status: z.enum(['passed', 'failed', 'blocked']), metrics: MetricsSchema }).strict();
export const PhaseAModelResultSchema = z.discriminatedUnion('status', [
  ModelResultBase.extend({ status: z.literal('passed'), blockedReason: z.never().optional() }), ModelResultBase.extend({ status: z.literal('failed'), blockedReason: z.never().optional() }),
  ModelResultBase.extend({ status: z.literal('blocked'), blockedReason: BlockedReasonSchema }),
]);
export type PhaseAModelResult = z.infer<typeof PhaseAModelResultSchema>;
export const PhaseARepairReportSchema = z.object({
  kind: z.literal('reconciliation-phase-a-repair-report'), version: z.literal(PHASE_A_VERSION), status: z.enum(['passed', 'failed', 'blocked']),
  models: z.array(PhaseAModelResultSchema).min(1).max(32), fixtureIds: z.array(z.string().regex(/^fixture-[a-z0-9-]+$/u)).max(32),
  positives: z.number().int().nonnegative().max(32), negatives: z.number().int().nonnegative().max(32),
}).strict().superRefine((report, ctx) => {
  if (new Set(report.fixtureIds).size !== report.fixtureIds.length) ctx.addIssue({ code: 'custom', path: ['fixtureIds'], message: 'duplicate fixture ID' });
  if (report.status === 'blocked' && !report.models.some((model) => model.status === 'blocked')) ctx.addIssue({ code: 'custom', path: ['status'], message: 'blocked report requires blocked model' });
  const derivedStatus = report.models.some((model) => model.status === 'blocked') ? 'blocked' : report.models.every((model) => model.status === 'passed') ? 'passed' : 'failed';
  if (report.status !== derivedStatus) ctx.addIssue({ code: 'custom', path: ['status'], message: 'report status does not match model results' });
  if (report.positives + report.negatives !== report.fixtureIds.length) ctx.addIssue({ code: 'custom', path: ['fixtureIds'], message: 'fixture totals do not match IDs' });
});
export type PhaseARepairReport = z.infer<typeof PhaseARepairReportSchema>;
export interface PhaseABakeoffOptions { scratchRoot: string; adapters: readonly FormatterAdapter[]; timeoutMs?: number; maxOutputBytes?: number; fixtures?: readonly RepairFixture[]; publish?: boolean; }
export interface PhaseABakeoffResult { report: PhaseARepairReport; reportJsonPath: string; reportMarkdownPath: string; }
const DEFAULT_TIMEOUT_MS = 30_000; const MAX_TIMEOUT_MS = 120_000; const DEFAULT_MAX_OUTPUT_BYTES = 2_000_000;
const fixturePrompt = (fixture: RepairFixture) => ['Phase A isolated formatter bake-off. Return exactly one JSON repair envelope.', 'Positive fixtures must be repaired exactly; negative fixtures must be refused with their exact closed reason.', `fixture-payload=${JSON.stringify(fixture)}`].join('\n');
function ownerOnlyMode(mode: number): boolean { return (mode & 0o777) === 0o700; }
async function ensureSafeScratch(input: string): Promise<string> {
  if (!isAbsolute(input)) throw new Error('scratch root must be absolute'); const root = resolve(input); let info;
  try { info = await lstat(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(root, { recursive: true, mode: 0o700 }); info = await lstat(root); }
  if (info.isSymbolicLink() || !info.isDirectory() || !ownerOnlyMode(info.mode)) throw new Error('scratch root must be an owner-only directory');
  if (await realpath(root) !== root) throw new Error('scratch root must not traverse symlinks');
  if ((await readdir(root)).length !== 0) throw new Error('scratch root must be absent or empty');
  return root;
}
async function freshDir(path: string): Promise<void> {
  try { const info = await lstat(path); if (info.isSymbolicLink() || !info.isDirectory() || !ownerOnlyMode(info.mode) || await realpath(path) !== path || (await readdir(path)).length !== 0) throw new Error('model scratch directory must be absent or empty and owner-only'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(path, { recursive: true, mode: 0o700 }); }
}
async function ensureReportRoot(root: string): Promise<void> {
  if (!isAbsolute(root)) throw new Error('report root must be absolute');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory() || !ownerOnlyMode(info.mode) || await realpath(root) !== resolve(root)) throw new Error('report root must be owner-only and symlink-free');
}
async function atomicWrite(path: string, content: string, interrupted = false): Promise<void> {
  const temp = join(dirname(path), `.${path.split('/').pop()}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`);
  try { await writeFile(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); const handle = await open(temp, constants.O_RDONLY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } if (interrupted) throw new Error('publication interrupted'); await rename(temp, path); const dir = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY); try { await dir.sync(); } finally { await dir.close(); } }
  finally { await rm(temp, { force: true }).catch(() => undefined); }
}
interface RepairEnvelope { repairable?: unknown; repairedOutput?: unknown; reason?: unknown }
function parseEnvelope(stdout: string, maxBytes: number): RepairEnvelope { if (Buffer.byteLength(stdout, 'utf8') > maxBytes) throw new Error('output exceeds bound'); const parsed: unknown = JSON.parse(stdout); if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid formatter receipt'); return parsed as RepairEnvelope; }
function equalJson(left: unknown, right: unknown): boolean { return isDeepStrictEqual(left, right); }
function percent(part: number, total: number): number { return total === 0 ? 100 : (part / total) * 100; }
function emptyMetrics(fixtures: readonly RepairFixture[]): z.infer<typeof MetricsSchema> { const positives = fixtures.filter((f) => f.expectation === 'repair').length; return { fixtures: fixtures.length, positives, negatives: fixtures.length - positives, positivesAccepted: 0, negativesRefused: 0, positiveAcceptancePercent: 0, negativeRefusalPercent: 0, apiCalls: 0, toolCalls: 0 }; }
function markdown(report: PhaseARepairReport): string { return [`# Phase A format-repair report`, ``, `- Status: ${report.status}`, `- Fixtures: ${report.fixtureIds.length}`, `- Positives: ${report.positives}`, `- Negatives: ${report.negatives}`, ``, `| Provider | Model | Status | Fixtures | Positive % | Negative % | API calls |`, `|---|---|---:|---:|---:|---:|---:|`, ...report.models.map((m) => `| ${m.provider} | ${m.model} | ${m.status} | ${m.metrics.fixtures} | ${m.metrics.positiveAcceptancePercent}% | ${m.metrics.negativeRefusalPercent}% | ${m.metrics.apiCalls} |`), ``].join('\n'); }

export async function publishPhaseAReport(root: string, report: PhaseARepairReport, options: { interrupted?: boolean } = {}): Promise<{ reportJsonPath: string; reportMarkdownPath: string }> {
  const parsed = PhaseARepairReportSchema.parse(report); await ensureReportRoot(root);
  const jsonPath = join(root, 'phase-a-report.json'); const markdownPath = join(root, 'phase-a-report.md'); await atomicWrite(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`, options.interrupted); await atomicWrite(markdownPath, markdown(parsed), options.interrupted); return { reportJsonPath: jsonPath, reportMarkdownPath: markdownPath };
}

function validateOptions(options: PhaseABakeoffOptions): { timeoutMs: number; maxOutputBytes: number; fixtures: readonly RepairFixture[] } {
  if (!Array.isArray(options.adapters) || options.adapters.length === 0) throw new Error('at least one adapter is required');
  const identities = options.adapters.map((a) => IdentitySchema.parse(a.identity)); const seen = new Set<string>();
  for (const identity of identities) { const key = `${identity.provider}\0${identity.model}`; if (seen.has(key)) throw new Error('duplicate adapter identity'); seen.add(key); }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS; const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || maxOutputBytes > DEFAULT_MAX_OUTPUT_BYTES) throw new Error('invalid bounds');
  const fixtures = z.array(RepairFixtureSchema).min(1).max(32).parse(options.fixtures ?? allRepairFixtures);
  if (new Set(fixtures.map((f) => f.id)).size !== fixtures.length) throw new Error('duplicate fixture ID');
  return { timeoutMs, maxOutputBytes, fixtures };
}
function syntheticValidation(expected: Record<string, unknown>): Parameters<typeof evaluateFormatRepair>[0]['validation'] {
  const authority = {
    packet: { schemaVersion: 'reconciliation.v1', promptVersion: 'synthetic-prompt', chunk: { id: 'chunk-synthetic-a', start: 0, end: 10 }, cacheIdentity: { inputHash: 'hash-source-a', contextHash: 'hash-context-a' } },
    authoritativeSourceEvents: [{ id: 'event-synthetic-a', text: 'Speaker A said hello.', start: 1, end: 2 }],
  } as unknown as Parameters<typeof evaluateFormatRepair>[0]['validation'];
  const identity = { schemaVersion: expected['schemaVersion'], promptVersion: expected['promptVersion'], chunk: expected['chunk'], cacheIdentity: expected['cacheIdentity'] };
  if (!isDeepStrictEqual(identity, authority.packet)) throw new Error('fixture identity does not match synthetic authority');
  return authority;
}

function snapshotAdapterResult(value: unknown, maxOutputBytes: number): { stdout: string; usage: unknown } {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) throw new Error('invalid adapter result');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!descriptors['stdout'] || !descriptors['usage'] || Object.keys(descriptors).length !== 2 || !('value' in descriptors['stdout']) || !('value' in descriptors['usage'])) throw new Error('invalid adapter result');
  const stdout = descriptors['stdout'].value;
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) throw new Error('invalid adapter output');
  const usageValue = descriptors['usage'].value;
  if (usageValue === null || typeof usageValue !== 'object' || Array.isArray(usageValue) || Object.getPrototypeOf(usageValue) !== Object.prototype || Object.getOwnPropertySymbols(usageValue).length) throw new Error('invalid adapter usage');
  const usageDescriptors = Object.getOwnPropertyDescriptors(usageValue);
  const usage: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(usageDescriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid adapter usage');
    usage[key] = descriptor.value;
  }
  return { stdout, usage };
}

export async function runPhaseABakeoff(options: PhaseABakeoffOptions): Promise<PhaseABakeoffResult> {
  const { timeoutMs, maxOutputBytes, fixtures } = validateOptions(options); const root = await ensureSafeScratch(options.scratchRoot); const modelResults: PhaseAModelResult[] = [];
  for (const [index, adapter] of options.adapters.entries()) {
    const modelRoot = join(root, `model-${index}`); const scratchDir = join(modelRoot, 'scratch'); const resultDir = join(modelRoot, 'results'); const metrics = emptyMetrics(fixtures); let blockedReason: BlockedReason | undefined; let failed = false;
    try { await freshDir(modelRoot); await freshDir(scratchDir); await freshDir(resultDir); } catch { modelResults.push({ provider: adapter.identity.provider, model: adapter.identity.model, status: 'blocked', blockedReason: 'blocked-no-context-isolation', metrics }); continue; }
    for (const fixture of fixtures) {
      let receipt: RepairEnvelope;
      try {
        metrics.apiCalls += 1;
        const controller = new AbortController();
        const invocation = Promise.resolve(adapter.invoke({ prompt: fixturePrompt(fixture), timeoutMs, maxOutputBytes, scratchDir, signal: controller.signal }));
        invocation.catch(() => undefined);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([invocation, new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('formatter timeout')); }, timeoutMs); })]).finally(() => { if (timeout) clearTimeout(timeout); });
        const snapshot = snapshotAdapterResult(result, maxOutputBytes);
        await atomicWrite(join(resultDir, `receipt-${fixture.id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
        const usageResult = UsageSchema.safeParse(snapshot.usage);
        if (!usageResult.success) {
          const raw = snapshot.usage as { toolAvailability?: unknown; toolCalls?: unknown };
          if (raw?.toolAvailability !== 'none' || raw?.toolCalls !== 0) blockedReason = 'blocked-no-zero-tool-seam'; else failed = true;
          break;
        }
        const usage = usageResult.data;
        if (usage.provider !== adapter.identity.provider || usage.model !== adapter.identity.model) { blockedReason = 'model-identity-unproven'; break; }
        receipt = parseEnvelope(snapshot.stdout, maxOutputBytes);
        if (fixture.expectation === 'repair') {
          if (receipt.repairable !== true || !equalJson(receipt.repairedOutput, fixture.expectedRepairedOutput)) { failed = true; continue; }
          const candidatePath = join(resultDir, `candidate-${fixture.id}.json`); await atomicWrite(candidatePath, `${JSON.stringify(receipt.repairedOutput)}\n`); const reread = JSON.parse(await readFile(candidatePath, 'utf8')) as Record<string, unknown>;
          const evaluation = await evaluateFormatRepair({ originalOutput: fixture.originalOutput, validation: syntheticValidation(fixture.expectedRepairedOutput as Record<string, unknown>), invoke: async () => JSON.stringify({ repairable: true, repairedOutput: reread }), timeoutMs, maxOutputBytes });
          const expectedCandidate = { ...reread, status: 'needs_review' }; if (evaluation.outcome !== 'accepted' || !evaluation.candidate || !equalJson(evaluation.candidate, expectedCandidate)) { failed = true; continue; }
          metrics.positivesAccepted += 1;
        } else if (receipt.repairable !== false || receipt.reason !== fixture.expectedUnrepairableReason) failed = true; else metrics.negativesRefused += 1;
      } catch { failed = true; }
    }
    metrics.positiveAcceptancePercent = percent(metrics.positivesAccepted, metrics.positives); metrics.negativeRefusalPercent = percent(metrics.negativesRefused, metrics.negatives);
    if (blockedReason) modelResults.push({ provider: adapter.identity.provider, model: adapter.identity.model, status: 'blocked', blockedReason, metrics }); else if (!failed && metrics.positiveAcceptancePercent === 100 && metrics.negativeRefusalPercent === 100) modelResults.push({ provider: adapter.identity.provider, model: adapter.identity.model, status: 'passed', metrics }); else modelResults.push({ provider: adapter.identity.provider, model: adapter.identity.model, status: 'failed', metrics });
  }
  const status = modelResults.some((m) => m.status === 'blocked') ? 'blocked' : modelResults.every((m) => m.status === 'passed') ? 'passed' : 'failed'; const report = PhaseARepairReportSchema.parse({ kind: 'reconciliation-phase-a-repair-report', version: PHASE_A_VERSION, status, models: modelResults, fixtureIds: fixtures.map((f) => f.id), positives: fixtures.filter((f) => f.expectation === 'repair').length, negatives: fixtures.filter((f) => f.expectation === 'unrepairable').length }); const paths = options.publish === false ? { reportJsonPath: join(root, 'phase-a-report.json'), reportMarkdownPath: join(root, 'phase-a-report.md') } : await publishPhaseAReport(root, report); return { report, ...paths };
}
export const runFormatRepairBakeoff = runPhaseABakeoff;

export interface ProcessFormatterAdapterOptions { identity: { provider: string; model: string }; executable: string; args?: readonly string[]; env?: NodeJS.ProcessEnv; }
export function createProcessFormatterAdapter(options: ProcessFormatterAdapterOptions): FormatterAdapter {
  const identity = IdentitySchema.parse(options.identity); if (!isAbsolute(options.executable) || options.executable.includes('\0')) throw new Error('invalid executable');
  return { identity, invoke: ({ prompt, timeoutMs, maxOutputBytes, scratchDir, signal }) => new Promise((resolvePromise, reject) => {
    const child = spawn(options.executable, [...(options.args ?? [])], { cwd: scratchDir, env: options.env ?? process.env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'ignore'] }); let output = ''; let bytes = 0; let settled = false; let primary: Error | undefined; let timeoutTimer: ReturnType<typeof setTimeout> | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => terminate(new Error('formatter aborted'));
    const clearTimers = () => { if (timeoutTimer) clearTimeout(timeoutTimer); if (killTimer) clearTimeout(killTimer); signal.removeEventListener('abort', onAbort); };
    const signalGroup = (signal: NodeJS.Signals) => { if (!child.pid) return; try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already reaped */ } } };
    const terminate = (error: Error) => { if (primary) return; primary = error; signalGroup('SIGTERM'); killTimer = setTimeout(() => signalGroup('SIGKILL'), 250); };
    child.stdout.on('data', (chunk: Buffer) => { if (settled) return; bytes += chunk.byteLength; if (bytes > maxOutputBytes) terminate(new Error('bounded output violation')); else output += chunk.toString('utf8'); });
    child.stdin.on('error', (error) => terminate(error)); child.on('error', (error) => { if (!primary) primary = error; });
    child.on('close', (code) => { clearTimers(); if (settled) return; settled = true; if (primary) { reject(primary); return; } if (code !== 0) { reject(new Error('formatter process failed')); return; } try { const receipt = UsageReceiptSchema.parse(JSON.parse(output)); resolvePromise({ stdout: receipt.stdout, usage: receipt.usage as z.infer<typeof UsageSchema> }); } catch { reject(new Error('invalid formatter receipt')); } });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    timeoutTimer = setTimeout(() => terminate(new Error('formatter timeout')), timeoutMs); child.stdin.end(prompt);
  }) };
}
export const UsageReceiptSchema = z.object({ stdout: z.string().max(DEFAULT_MAX_OUTPUT_BYTES), usage: RuntimeUsageSchema }).strict();

const HERMES_PROVIDER = 'openai-codex' as const;
const HERMES_TOOLSET = 'context_engine' as const;
const MAX_INLINE_PROMPT_BYTES = 64 * 1024;
const MAX_USAGE_BYTES = 64 * 1024;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;

export interface HermesOneShotFormatterAdapterOptions {
  executable: string;
  model: string;
  scratchDir: string;
  env?: NodeJS.ProcessEnv;
}

function allowlistedEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const source = { ...process.env, ...overrides };
  const output: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) if (source[key] !== undefined) output[key] = source[key];
  for (const key of Object.keys(source)) if (key.startsWith('LC_') && source[key] !== undefined) output[key] = source[key];
  return output;
}

async function openHermesExecutable(executable: string): Promise<Awaited<ReturnType<typeof open>>> {
  if (!isAbsolute(executable) || executable.includes('\\0')) throw new Error('invalid Hermes executable');
  const handle = await open(executable, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o111) === 0) throw new Error('Hermes executable must be a regular executable file');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function validateInvocationParent(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Hermes scratch directory must be absolute');
  const resolved = resolve(path); const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || !ownerOnlyMode(info.mode) || await realpath(resolved) !== resolved) throw new Error('Hermes scratch directory must be owner-only and symlink-free');
  return resolved;
}

function usageFromHermes(value: unknown, expectedModel: string, invocationCwd: string): z.infer<typeof UsageSchema> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('missing or malformed Hermes usage receipt');
  const raw = value as Record<string, unknown>;
  const usage = UsageSchema.parse({
    provider: raw['provider'], model: raw['model'], inputTokens: raw['input_tokens'] ?? null, outputTokens: raw['output_tokens'] ?? null,
    apiCalls: raw['api_calls'], toolAvailability: 'none', toolCalls: 0, safeMode: true, userConfigIgnored: true,
    rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: raw['session_id'],
  });
  if (usage.provider !== HERMES_PROVIDER || usage.model !== expectedModel || !SESSION_ID.test(usage.sessionId) || !invocationCwd) throw new Error('Hermes usage identity does not match invocation');
  return usage;
}

export function createHermesOneShotFormatterAdapter(options: HermesOneShotFormatterAdapterOptions): FormatterAdapter {
  const identity = IdentitySchema.parse({ provider: HERMES_PROVIDER, model: options.model });
  if (options.model.length > 120) throw new Error('invalid Hermes model');
  const invoke = async ({ prompt, timeoutMs, maxOutputBytes, scratchDir, signal }: Parameters<FormatterAdapter['invoke']>[0]): Promise<Awaited<ReturnType<FormatterAdapter['invoke']>>> => {
    if (signal.aborted) throw new Error('formatter aborted');
    if (Buffer.byteLength(prompt, 'utf8') > MAX_INLINE_PROMPT_BYTES) throw new Error('Hermes inline prompt exceeds bound');
    const parent = await validateInvocationParent(scratchDir);
    if (resolve(options.scratchDir) !== parent) throw new Error('Hermes scratch directory mismatch');
    const invocationCwd = join(parent, `invocation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const usagePath = join(parent, `.usage-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    let executableHandle: Awaited<ReturnType<typeof open>> | undefined; let child: ReturnType<typeof spawn> | undefined; let output = ''; let bytes = 0; let primary: Error | undefined; let settled = false; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (error: Error) => { if (primary || !child) return; primary = error; if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } killTimer = setTimeout(() => { try { if (child?.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* reaped */ } }, 250); killTimer.unref(); } };
    const groupExists = () => { if (!child?.pid) return false; try { process.kill(-child.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };
    const drainGroup = async () => {
      if (!groupExists()) { if (killTimer) clearTimeout(killTimer); return; }
      if (!primary) terminate(new Error('Hermes one-shot left a descendant process'));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
      if (killTimer) clearTimeout(killTimer);
      if (groupExists()) { try { if (child?.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* reaped */ } await new Promise((resolvePromise) => setTimeout(resolvePromise, 50)); }
      if (groupExists()) throw new Error('Hermes process group did not terminate');
    };
    try {
      executableHandle = await openHermesExecutable(options.executable);
      await mkdir(invocationCwd, { mode: 0o700 });
      if ((await readdir(invocationCwd)).length !== 0) throw new Error('Hermes invocation cwd must start empty');
      await writeFile(usagePath, '', { mode: 0o600, flag: 'wx' });
      if (signal.aborted) throw new Error('formatter aborted');
      child = spawn('/proc/self/fd/3', ['-z', prompt, '-m', options.model, '--provider', HERMES_PROVIDER, '--usage-file', usagePath, '--safe-mode', '-t', HERMES_TOOLSET], { cwd: invocationCwd, env: allowlistedEnvironment(options.env), shell: false, detached: true, stdio: ['ignore', 'pipe', 'ignore', executableHandle.fd] });
      child.stdout!.on('data', (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > maxOutputBytes) terminate(new Error('bounded output violation')); else output += chunk.toString('utf8'); });
      child.on('error', (error) => terminate(error));
      const abort = () => terminate(new Error('formatter aborted')); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const timer = setTimeout(() => terminate(new Error('formatter timeout')), timeoutMs); timer.unref();
      const closeCode = await new Promise<number | null>((resolvePromise) => child!.on('close', resolvePromise));
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      await drainGroup();
      if (primary) throw primary;
      if (closeCode !== 0) throw new Error('Hermes one-shot failed');
      if ((await readdir(invocationCwd)).length !== 0) throw new Error('Hermes invocation cwd was modified');
      const usageHandle = await open(usagePath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined);
      if (!usageHandle) throw new Error('missing or malformed Hermes usage receipt');
      let usageText: string;
      try {
        const before = await usageHandle.stat();
        if (!before.isFile() || (before.mode & 0o777) !== 0o600 || before.size > MAX_USAGE_BYTES) throw new Error('missing or malformed Hermes usage receipt');
        usageText = await usageHandle.readFile({ encoding: 'utf8' });
        const after = await usageHandle.stat();
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Hermes usage receipt changed during read');
      } finally { await usageHandle.close(); }
      const usage = usageFromHermes(JSON.parse(usageText), options.model, invocationCwd);
      return { stdout: output, usage };
    } finally {
      if (!settled && child) terminate(new Error('Hermes invocation cleanup'));
      if (killTimer) clearTimeout(killTimer);
      if (executableHandle) await executableHandle.close().catch(() => undefined);
      await rm(usagePath, { force: true }).catch(() => undefined);
      await rm(invocationCwd, { recursive: true, force: true }).catch(() => undefined);
    }
  };
  return { identity, invoke };
}
