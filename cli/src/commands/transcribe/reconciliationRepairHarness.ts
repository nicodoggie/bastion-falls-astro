import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ReconciliationResponseSchema, validateReconciliation } from './reconciliation.js';
import { classifyRepairFailure, evaluateFormatRepair, type RepairEnvelope, type RepairUnrepairableReason, type RepairValidationInput } from './reconciliationRepair.js';
import { allRepairFixtures, RepairFixtureSchema, type RepairFixture } from './reconciliationRepairFixtures.js';
import { createRepairValidationSession, type RepairValidationResult } from './reconciliationRepairValidatorTool.js';

export const PHASE_A_VERSION = 1 as const;
export const BLOCKED_REASONS = ['blocked-no-zero-tool-seam', 'blocked-no-validator-tool-seam', 'blocked-no-context-isolation', 'model-identity-unproven'] as const;
export const BlockedReasonSchema = z.enum(BLOCKED_REASONS);
export type BlockedReason = z.infer<typeof BlockedReasonSchema>;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const IdentitySchema = z.object({ provider: z.string().regex(SAFE_IDENTIFIER), model: z.string().regex(SAFE_IDENTIFIER) }).strict();
const UsageSchema = z.object({
  provider: z.string().regex(SAFE_IDENTIFIER), model: z.string().regex(SAFE_IDENTIFIER),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  apiCalls: z.number().int().positive().max(3), toolAvailability: z.enum(['none', 'validator-only']),
  availableTools: z.array(z.string().regex(SAFE_IDENTIFIER)).max(1).optional(), toolCalls: z.number().int().nonnegative().max(2),
  safeMode: z.literal(true), userConfigIgnored: z.literal(true), rulesIgnored: z.literal(true), profile: z.literal('none'),
  inlinePrompt: z.literal(true), cwdIsolated: z.literal(true), environmentAllowlisted: z.literal(true),
  sessionId: z.string().regex(SAFE_IDENTIFIER),
}).strict();
const RuntimeUsageSchema = z.object({
  provider: z.string().regex(SAFE_IDENTIFIER), model: z.string().regex(SAFE_IDENTIFIER),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  apiCalls: z.number().int().nonnegative().max(3), toolAvailability: z.enum(['none', 'available', 'validator-only']),
  availableTools: z.array(z.string().regex(SAFE_IDENTIFIER)).max(100).optional(), toolCalls: z.number().int().nonnegative().max(100),
  safeMode: z.boolean(), userConfigIgnored: z.boolean(), rulesIgnored: z.boolean(), profile: z.string().regex(SAFE_IDENTIFIER),
  inlinePrompt: z.boolean(), cwdIsolated: z.boolean(), environmentAllowlisted: z.boolean(), sessionId: z.string().regex(SAFE_IDENTIFIER),
}).strict();
export interface FormatterAdapter {
  identity: z.infer<typeof IdentitySchema>;
  invoke(input: { prompt: string; timeoutMs: number; maxOutputBytes: number; scratchDir: string; signal: AbortSignal; validateCandidate?(candidate: unknown): Promise<RepairValidationResult>; validationRequest?: { originalOutput: string; validation: RepairValidationInput; expectedUnrepairableReason?: RepairUnrepairableReason } }): Promise<{ stdout: string; usage: z.infer<typeof UsageSchema> }>;
}
const MetricsSchema = z.object({
  fixtures: z.number().int().nonnegative().max(32), positives: z.number().int().nonnegative().max(32), negatives: z.number().int().nonnegative().max(32),
  positivesAccepted: z.number().int().nonnegative().max(32), negativesRefused: z.number().int().nonnegative().max(32),
  firstSubmissionAccepted: z.number().int().nonnegative().max(32), correctedSubmissionAccepted: z.number().int().nonnegative().max(32),
  positiveAcceptancePercent: z.number().finite().min(0).max(100), negativeRefusalPercent: z.number().finite().min(0).max(100),
  apiCalls: z.number().int().nonnegative().max(10000), toolCalls: z.number().int().nonnegative().max(10000),
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
function formatterFixturePayload(fixture: RepairFixture): Record<string, unknown> {
  let parsed: unknown;
  let classification: string;
  try { parsed = JSON.parse(fixture.originalOutput); }
  catch (error) { classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, parseError: error }).classification; return { originalOutput: fixture.originalOutput, issueCodes: fixture.expectedIssueCodes, classification }; }
  const schema = ReconciliationResponseSchema.safeParse(parsed);
  if (!schema.success) classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, parsedValue: parsed, zodIssues: schema.error.issues }).classification;
  else {
    const authorityOutput = allRepairFixtures.find((item) => item.expectation === 'repair')?.expectedRepairedOutput;
    if (!authorityOutput) throw new Error('missing synthetic authority');
    const authority = syntheticValidation(authorityOutput as Record<string, unknown>);
    const identity = { schemaVersion: schema.data.schemaVersion, promptVersion: schema.data.promptVersion, chunk: schema.data.chunk, cacheIdentity: schema.data.cacheIdentity };
    if (!isDeepStrictEqual(identity, authority.packet)) classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, failureCategory: 'identity-mismatch' }).classification;
    else {
      try { validateReconciliation(schema.data, { authoritativeSourceEvents: authority.authoritativeSourceEvents }); classification = 'valid'; }
      catch { classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, failureCategory: 'unknown-event' }).classification; }
    }
  }
  return { originalOutput: fixture.originalOutput, issueCodes: fixture.expectedIssueCodes, classification };
}
const fixturePrompt = (fixture: RepairFixture) => ['Phase A isolated formatter bake-off.', 'Submit exactly one of these strict envelopes: {"repairable":true,"repairedOutput":<strict reconciliation.v1 object>} or {"repairable":false,"reason":"incomplete-original|semantic-change-required|identity-change-required|unsupported-repair"}.', 'Repair representation only. If the supplied classification is unrepairable, refuse with its corresponding closed reason. Do not add, remove, paraphrase, summarize, reinterpret, correct, or reorder semantic content.', 'When validate_repair_json is available, call it with the complete envelope; its last valid argument is authoritative. Return no Markdown or commentary.', `fixture-payload=${JSON.stringify(formatterFixturePayload(fixture))}`].join('\n');
const VALIDATOR_ONLY_FIXTURE_IDS = new Set(['fixture-changed-readable-text', 'fixture-changed-summary-safe-text', 'fixture-changed-correction', 'fixture-changed-attribution']);
export const phaseAModelRepairFixtures = allRepairFixtures.filter((fixture) => !VALIDATOR_ONLY_FIXTURE_IDS.has(fixture.id));
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
function parseEnvelope(stdout: string, maxBytes: number): RepairEnvelope { if (Buffer.byteLength(stdout, 'utf8') > maxBytes) throw new Error('output exceeds bound'); const parsed: unknown = JSON.parse(stdout); if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid formatter receipt'); return parsed as RepairEnvelope; }
function equalJson(left: unknown, right: unknown): boolean { return isDeepStrictEqual(left, right); }
function percent(part: number, total: number): number { return total === 0 ? 100 : (part / total) * 100; }
function emptyMetrics(fixtures: readonly RepairFixture[]): z.infer<typeof MetricsSchema> { const positives = fixtures.filter((f) => f.expectation === 'repair').length; return { fixtures: fixtures.length, positives, negatives: fixtures.length - positives, positivesAccepted: 0, negativesRefused: 0, firstSubmissionAccepted: 0, correctedSubmissionAccepted: 0, positiveAcceptancePercent: 0, negativeRefusalPercent: 0, apiCalls: 0, toolCalls: 0 }; }
function markdown(report: PhaseARepairReport): string { return [`# Phase A format-repair report`, ``, `- Status: ${report.status}`, `- Fixtures: ${report.fixtureIds.length}`, `- Positives: ${report.positives}`, `- Negatives: ${report.negatives}`, ``, `| Provider | Model | Status | Fixtures | Positive % | Negative % | First pass | Corrected | API calls | Tool calls |`, `|---|---|---:|---:|---:|---:|---:|---:|---:|---:|`, ...report.models.map((m) => `| ${m.provider} | ${m.model} | ${m.status} | ${m.metrics.fixtures} | ${m.metrics.positiveAcceptancePercent}% | ${m.metrics.negativeRefusalPercent}% | ${m.metrics.firstSubmissionAccepted} | ${m.metrics.correctedSubmissionAccepted} | ${m.metrics.apiCalls} | ${m.metrics.toolCalls} |`), ``].join('\n'); }

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
  const fixtures = z.array(RepairFixtureSchema).min(1).max(32).parse(options.fixtures ?? phaseAModelRepairFixtures);
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
        const authorityOutput = fixture.expectation === 'repair'
          ? fixture.expectedRepairedOutput
          : allRepairFixtures.find((item) => item.expectation === 'repair')?.expectedRepairedOutput;
        if (!authorityOutput) throw new Error('missing synthetic authority');
        const validation = syntheticValidation(authorityOutput as Record<string, unknown>);
        const validator = createRepairValidationSession({
          originalOutput: fixture.originalOutput,
          validation,
          ...(fixture.expectation === 'unrepairable' ? { expectedUnrepairableReason: fixture.expectedUnrepairableReason } : {}),
          timeoutMs,
          maxOutputBytes,
        });
        metrics.apiCalls += 1;
        const controller = new AbortController();
        const invocation = Promise.resolve(adapter.invoke({ prompt: fixturePrompt(fixture), timeoutMs, maxOutputBytes, scratchDir, signal: controller.signal, validateCandidate: (candidate) => validator.submit(candidate), validationRequest: { originalOutput: fixture.originalOutput, validation, expectedUnrepairableReason: fixture.expectedUnrepairableReason } }));
        invocation.catch(() => undefined);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([invocation, new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('formatter timeout')); }, timeoutMs); })]).finally(() => { if (timeout) clearTimeout(timeout); });
        const snapshot = snapshotAdapterResult(result, maxOutputBytes);
        await atomicWrite(join(resultDir, `receipt-${fixture.id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
        const usageResult = UsageSchema.safeParse(snapshot.usage);
        if (!usageResult.success) {
          const raw = snapshot.usage as { toolAvailability?: unknown; toolCalls?: unknown };
          if (raw?.toolAvailability !== 'none' || raw?.toolCalls !== 0) blockedReason = 'blocked-no-validator-tool-seam'; else failed = true;
          break;
        }
        const usage = usageResult.data;
        if (usage.provider !== adapter.identity.provider || usage.model !== adapter.identity.model) { blockedReason = 'model-identity-unproven'; break; }
        if (usage.toolAvailability === 'validator-only') {
          if (!equalJson(usage.availableTools, ['validate_repair_json']) || usage.toolCalls !== validator.callCount() || usage.toolCalls < 1 || usage.toolCalls > 2 || usage.apiCalls !== usage.toolCalls + 1) { blockedReason = 'blocked-no-validator-tool-seam'; break; }
          metrics.apiCalls += usage.apiCalls - 1;
          metrics.toolCalls += usage.toolCalls;
          const sealed = validator.sealedCandidate();
          if (!sealed) { failed = true; continue; }
          if (usage.toolCalls === 1) metrics.firstSubmissionAccepted += 1; else metrics.correctedSubmissionAccepted += 1;
          receipt = sealed;
        } else {
          if (usage.availableTools !== undefined || usage.toolCalls !== 0 || validator.callCount() !== 0 || usage.apiCalls !== 1) { blockedReason = 'blocked-no-zero-tool-seam'; break; }
          metrics.apiCalls += usage.apiCalls - 1;
          receipt = parseEnvelope(snapshot.stdout, maxOutputBytes);
        }
        if (fixture.expectation === 'repair') {
          if (receipt.repairable !== true || !equalJson(receipt.repairedOutput, fixture.expectedRepairedOutput)) { failed = true; continue; }
          const candidatePath = join(resultDir, `candidate-${fixture.id}.json`); await atomicWrite(candidatePath, `${JSON.stringify(receipt.repairedOutput)}\n`); const reread = JSON.parse(await readFile(candidatePath, 'utf8')) as Record<string, unknown>;
          const evaluation = await evaluateFormatRepair({ originalOutput: fixture.originalOutput, validation, invoke: async () => JSON.stringify({ repairable: true, repairedOutput: reread }), timeoutMs, maxOutputBytes });
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
    const child = spawn(options.executable, [...(options.args ?? [])], { cwd: scratchDir, env: allowlistedEnvironment(options.env), shell: false, detached: true, stdio: ['pipe', 'pipe', 'ignore'] }); let output = ''; let bytes = 0; let settled = false; let primary: Error | undefined; let timeoutTimer: ReturnType<typeof setTimeout> | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => terminate(new Error('formatter aborted'));
    const clearDeadline = () => { if (timeoutTimer) clearTimeout(timeoutTimer); signal.removeEventListener('abort', onAbort); };
    const groupExists = () => { if (!child.pid) return false; try { process.kill(-child.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };
    const signalGroup = (signal: NodeJS.Signals) => { if (!child.pid) return; try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already reaped */ } } };
    const terminate = (error: Error) => { if (primary) return; primary = error; signalGroup('SIGTERM'); killTimer = setTimeout(() => signalGroup('SIGKILL'), 250); };
    const drainGroup = async () => { if (!groupExists()) { if (killTimer) clearTimeout(killTimer); return; } if (!primary) primary = new Error('formatter left a descendant process'); signalGroup('SIGTERM'); await new Promise((resolvePromise) => setTimeout(resolvePromise, 300)); if (killTimer) clearTimeout(killTimer); if (groupExists()) { signalGroup('SIGKILL'); await new Promise((resolvePromise) => setTimeout(resolvePromise, 50)); } if (groupExists()) primary = new Error('formatter process group did not terminate'); };
    child.stdout.on('data', (chunk: Buffer) => { if (settled) return; bytes += chunk.byteLength; if (bytes > maxOutputBytes) terminate(new Error('bounded output violation')); else output += chunk.toString('utf8'); });
    child.stdin.on('error', (error) => terminate(error)); child.on('error', (error) => { if (!primary) primary = error; });
    child.on('close', (code) => { void (async () => { clearDeadline(); if (settled) return; settled = true; await drainGroup(); if (primary) { reject(primary); return; } if (code !== 0) { reject(new Error('formatter process failed')); return; } try { const receipt = UsageReceiptSchema.parse(JSON.parse(output)); resolvePromise({ stdout: receipt.stdout, usage: receipt.usage as z.infer<typeof UsageSchema> }); } catch { reject(new Error('invalid formatter receipt')); } })(); });
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
  if (!isAbsolute(executable) || executable.includes('\0')) throw new Error('invalid Hermes executable');
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

const HermesValidatorResultSchema = z.object({
  provider: z.literal(HERMES_PROVIDER), model: z.string().regex(SAFE_IDENTIFIER),
  input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(),
  api_calls: z.number().int().positive().max(3), tool_calls: z.number().int().min(0).max(2),
  available_tools: z.tuple([z.literal('validate_repair_json')]),
  calls: z.array(z.object({ candidate: z.unknown(), result: z.unknown() }).strict()).max(2),
  final_response: z.string().max(DEFAULT_MAX_OUTPUT_BYTES), session_id: z.string().regex(SESSION_ID),
  completed: z.boolean(), failed: z.boolean(), partial: z.boolean(),
  safe_mode: z.literal(true), user_config_ignored: z.literal(true), rules_ignored: z.literal(true),
  inline_prompt: z.literal(true), cwd_isolated: z.literal(true), environment_allowlisted: z.literal(true),
}).strict();

export interface HermesValidatorFormatterAdapterOptions {
  pythonExecutable: string;
  launcherPath: string;
  validatorPath: string;
  nodeExecutable: string;
  hermesRoot: string;
  sitePackages: string;
  tsxImportPath: string;
  model: string;
  scratchDir: string;
  env?: NodeJS.ProcessEnv;
}

async function openRegularFile(path: string, executable: boolean): Promise<Awaited<ReturnType<typeof open>>> {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('invalid isolated launcher path');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (executable && (info.mode & 0o111) === 0)) throw new Error('isolated launcher path must be a regular file');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function openDirectoryCustody(path: string): Promise<Awaited<ReturnType<typeof open>>> {
  if (!isAbsolute(path) || path.includes('\\0')) throw new Error('invalid isolated launcher directory');
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('isolated launcher directory must be a regular directory');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

export function createHermesValidatorFormatterAdapter(options: HermesValidatorFormatterAdapterOptions): FormatterAdapter {
  const identity = IdentitySchema.parse({ provider: HERMES_PROVIDER, model: options.model });
  if (options.model.length > 120) throw new Error('invalid Hermes model');
  return {
    identity,
    async invoke(input) {
      if (!input.validateCandidate || !input.validationRequest) throw new Error('validator-only invocation requires host validation');
      if (input.signal.aborted) throw new Error('formatter aborted');
      if (Buffer.byteLength(input.prompt, 'utf8') > MAX_INLINE_PROMPT_BYTES) throw new Error('Hermes inline prompt exceeds bound');
      const parent = await validateInvocationParent(input.scratchDir);
      if (resolve(options.scratchDir) !== parent) throw new Error('Hermes scratch directory mismatch');
      const hermesRoot = resolve(options.hermesRoot); const hermesInfo = await lstat(hermesRoot);
      if (!hermesInfo.isDirectory() || hermesInfo.isSymbolicLink() || await realpath(hermesRoot) !== hermesRoot) throw new Error('invalid Hermes root');
      const sitePackages = resolve(options.sitePackages); const siteInfo = await lstat(sitePackages);
      if (!siteInfo.isDirectory() || siteInfo.isSymbolicLink() || await realpath(sitePackages) !== sitePackages) throw new Error('invalid Hermes site-packages');
      let python: Awaited<ReturnType<typeof open>> | undefined; let launcher: Awaited<ReturnType<typeof open>> | undefined; let validator: Awaited<ReturnType<typeof open>> | undefined; let node: Awaited<ReturnType<typeof open>> | undefined; let tsxImport: Awaited<ReturnType<typeof open>> | undefined;
      let hermesRootHandle: Awaited<ReturnType<typeof open>> | undefined; let sitePackagesHandle: Awaited<ReturnType<typeof open>> | undefined;
      let invocationCwd: string | undefined; let cwdCreated = false;
      let child: ReturnType<typeof spawn> | undefined; let output = ''; let stderr = ''; let bytes = 0; let primary: Error | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined;
      const signalGroup = (signal: NodeJS.Signals) => { if (!child?.pid) return; try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* reaped */ } } };
      const terminate = (error: Error) => { if (primary) return; primary = error; signalGroup('SIGTERM'); killTimer = setTimeout(() => signalGroup('SIGKILL'), 250); killTimer.unref(); };
      const groupExists = () => { if (!child?.pid) return false; try { process.kill(-child.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };
      try {
        python = await openRegularFile(options.pythonExecutable, true);
        launcher = await openRegularFile(options.launcherPath, false);
        validator = await openRegularFile(options.validatorPath, false);
        node = await openRegularFile(options.nodeExecutable, true);
        tsxImport = await openRegularFile(options.tsxImportPath, false);
        hermesRootHandle = await openDirectoryCustody(options.hermesRoot);
        sitePackagesHandle = await openDirectoryCustody(options.sitePackages);
        invocationCwd = join(parent, `validator-invocation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(invocationCwd, { mode: 0o700 });
        cwdCreated = true;
        if ((await readdir(invocationCwd)).length !== 0) throw new Error('Hermes validator invocation cwd must start empty');
        child = spawn('/proc/self/fd/3', ['/proc/self/fd/4', '--model', options.model, '--provider', HERMES_PROVIDER, '--validator-fd', String(5), '--node-fd', String(6), '--tsx-fd', String(7), '--hermes-root-fd', String(8), '--site-packages-fd', String(9)], { cwd: invocationCwd, env: allowlistedEnvironment(options.env), shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe', python.fd, launcher.fd, validator.fd, node.fd, tsxImport.fd, hermesRootHandle.fd, sitePackagesHandle.fd] });
        child.stdout!.on('data', (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > input.maxOutputBytes) terminate(new Error('bounded output violation')); else output += chunk.toString('utf8'); });
        child.stderr!.on('data', (chunk: Buffer) => { if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length); });
        child.on('error', terminate);
        const abort = () => terminate(new Error('formatter aborted')); input.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => terminate(new Error('formatter timeout')), input.timeoutMs); timer.unref();
        child.stdin!.end(JSON.stringify({ prompt: input.prompt, ...input.validationRequest, nodeExecutable: options.nodeExecutable, tsxImportPath: options.tsxImportPath, validatorTimeoutSeconds: Math.max(1, Math.ceil(input.timeoutMs / 1000)), path: allowlistedEnvironment(options.env)['PATH'] ?? '', home: allowlistedEnvironment(options.env)['HOME'] ?? '' }));
        const code = await new Promise<number | null>((resolvePromise) => child!.on('close', resolvePromise));
        clearTimeout(timer); input.signal.removeEventListener('abort', abort);
        if (killTimer) clearTimeout(killTimer);
        if (groupExists()) { signalGroup('SIGKILL'); await new Promise((resolvePromise) => setTimeout(resolvePromise, 50)); }
        if (primary) throw primary;
        if (code !== 0) {
          const errorClass = [...stderr.matchAll(/^([A-Za-z][A-Za-z0-9_.]*(?:Error|Exception)):/gmu)].at(-1)?.[1] ?? 'unknown-error';
          throw new Error(`isolated Hermes validator launcher failed (${errorClass})`);
        }
        if ((await readdir(invocationCwd)).length !== 0) throw new Error('Hermes validator invocation cwd was modified');
        const raw: unknown = JSON.parse(output);
        if (raw && typeof raw === 'object' && 'launcher_failure' in raw) {
          const failure = raw as Record<string, unknown>;
          throw new Error(`isolated Hermes validator ${String(failure['launcher_failure'])} failure (${String(failure['error_type'])},toolCalls=${String(failure['tool_calls'] ?? 0)})`);
        }
        const parsed = HermesValidatorResultSchema.parse(raw);
        if (parsed.tool_calls === 0) throw new Error(`isolated Hermes validator produced no tool call (completed=${parsed.completed},failed=${parsed.failed},partial=${parsed.partial})`);
        if (parsed.model !== options.model || parsed.calls.length !== parsed.tool_calls || parsed.api_calls !== parsed.tool_calls + 1) throw new Error('isolated Hermes validator receipt mismatch');
        for (const call of parsed.calls) {
          const hostResult = await input.validateCandidate(call.candidate);
          if (!isDeepStrictEqual(hostResult, call.result)) throw new Error('isolated validator replay mismatch');
        }
        const usage = UsageSchema.parse({
          provider: parsed.provider, model: parsed.model, inputTokens: parsed.input_tokens, outputTokens: parsed.output_tokens,
          apiCalls: parsed.api_calls, toolAvailability: 'validator-only', availableTools: parsed.available_tools, toolCalls: parsed.tool_calls,
          safeMode: parsed.safe_mode, userConfigIgnored: parsed.user_config_ignored, rulesIgnored: parsed.rules_ignored,
          profile: 'none', inlinePrompt: parsed.inline_prompt, cwdIsolated: parsed.cwd_isolated, environmentAllowlisted: parsed.environment_allowlisted, sessionId: parsed.session_id,
        });
        return { stdout: parsed.final_response, usage };
      } finally {
        if (child && groupExists()) signalGroup('SIGKILL');
        if (killTimer) clearTimeout(killTimer);
        if (cwdCreated && invocationCwd) await rm(invocationCwd, { recursive: true, force: true }).catch(() => undefined);
        for (const handle of [python, launcher, validator, node, tsxImport, hermesRootHandle, sitePackagesHandle]) {
          if (handle) await handle.close().catch(() => undefined);
        }
      }
    },
  };
}