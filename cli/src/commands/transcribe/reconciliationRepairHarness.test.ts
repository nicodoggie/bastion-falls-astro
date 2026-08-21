import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PhaseAModelResultSchema,
  PhaseARepairReportSchema,
  publishPhaseAReport,
  runPhaseABakeoff,
  type FormatterAdapter,
  createProcessFormatterAdapter,
} from './reconciliationRepairHarness.js';
import { allRepairFixtures } from './reconciliationRepairFixtures.js';

test('runs canonical fixtures in order with identical prompts and publishes private metrics only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-'));
  const prompts: string[] = [];
  const adapter = (provider: string, model: string): FormatterAdapter => ({
    identity: { provider, model },
    async invoke(input) {
      prompts.push(input.prompt);
      const id = JSON.parse(input.prompt.split('fixture-payload=')[1]!).id as string;
      const fixture = allRepairFixtures.find((item) => item.id === id)!;
      const envelope = fixture.expectation === 'repair'
        ? { repairable: true, repairedOutput: fixture.expectedRepairedOutput }
        : { repairable: false, reason: fixture.expectedUnrepairableReason };
      return { stdout: JSON.stringify(envelope), usage: { provider, model, inputTokens: 1, outputTokens: 1, apiCalls: 1, toolAvailability: 'none', toolCalls: 0 } };
    },
  });
  const result = await runPhaseABakeoff({ scratchRoot: root, adapters: [adapter('p', 'm1'), adapter('p', 'm2')] });
  assert.equal(result.report.status, 'passed');
  assert.deepEqual(prompts.slice(0, allRepairFixtures.length), prompts.slice(allRepairFixtures.length));
  assert.deepEqual(result.report.fixtureIds, allRepairFixtures.map((fixture) => fixture.id));
  assert.equal(result.report.models[0]!.metrics.positiveAcceptancePercent, 100);
  assert.equal(result.report.models[0]!.metrics.negativeRefusalPercent, 100);
  const serialized = JSON.stringify(result.report);
  for (const fixture of allRepairFixtures) if (fixture.originalOutput.length > 0) assert.equal(serialized.includes(fixture.originalOutput), false);
  assert.equal(serialized.includes(root), false);
  const modelFiles = await readdir(join(root, 'model-0', 'results'));
  assert.equal(modelFiles.filter((name) => name.startsWith('candidate-')).length, allRepairFixtures.filter((fixture) => fixture.expectation === 'repair').length);
  const receipt = JSON.parse(await readFile(join(root, 'model-0', 'results', `receipt-${allRepairFixtures[0]!.id}.json`), 'utf8'));
  assert.equal(typeof receipt.stdout, 'string');
  assert.equal('envelope' in receipt, false);
  const reportText = `${await readFile(result.reportJsonPath, 'utf8')}\n${await readFile(result.reportMarkdownPath, 'utf8')}`;
  for (const sentinel of ['originalOutput', 'original-output=', root, 'credential', 'secret']) assert.equal(reportText.includes(sentinel), false, sentinel);
  for (const fixture of allRepairFixtures) if (fixture.originalOutput) assert.equal(reportText.includes(fixture.originalOutput), false, fixture.id);
  assert.equal((await stat(join(root, 'model-0'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, 'model-0', 'scratch'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, 'model-0', 'results'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, 'model-0', 'results', `receipt-${allRepairFixtures[0]!.id}.json`))).mode & 0o777, 0o600);
  await rm(root, { recursive: true, force: true });
});

test('blocks identity and tool violations while continuing to later models', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-'));
  const violating: FormatterAdapter = {
    identity: { provider: 'requested', model: 'bad' },
    async invoke() { return { stdout: '{}', usage: { provider: 'actual', model: 'bad', inputTokens: null, outputTokens: null, apiCalls: 1, toolAvailability: 'none', toolCalls: 0 } }; },
  };
  const good: FormatterAdapter = {
    identity: { provider: 'requested', model: 'good' },
    async invoke(input) {
      const id = JSON.parse(input.prompt.split('fixture-payload=')[1]!).id as string;
      const fixture = allRepairFixtures.find((item) => item.id === id)!;
      return { stdout: JSON.stringify(fixture.expectation === 'repair' ? { repairable: true, repairedOutput: fixture.expectedRepairedOutput } : { repairable: false, reason: fixture.expectedUnrepairableReason }), usage: { provider: 'requested', model: 'good', inputTokens: null, outputTokens: null, apiCalls: 1, toolAvailability: 'none', toolCalls: 0 } };
    },
  };
  const failing: FormatterAdapter = {
    identity: { provider: 'requested', model: 'ordinary-failure' },
    async invoke() { return { stdout: '{}', usage: { provider: 'requested', model: 'ordinary-failure', inputTokens: null, outputTokens: null, apiCalls: 1, toolAvailability: 'none', toolCalls: 0 } }; },
  };
  const hanging: FormatterAdapter = {
    identity: { provider: 'requested', model: 'hanging' },
    async invoke({ signal }) { return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); },
  };
  let getterReads = 0;
  const hostile: FormatterAdapter = {
    identity: { provider: 'requested', model: 'hostile' },
    async invoke() {
      const value = Object.defineProperty({ usage: {} }, 'stdout', { enumerable: true, get() { getterReads += 1; return '{}'; } });
      return value as unknown as Awaited<ReturnType<FormatterAdapter['invoke']>>;
    },
  };
  const result = await runPhaseABakeoff({ scratchRoot: root, adapters: [violating, failing, hanging, hostile, good], timeoutMs: 20 });
  assert.equal(result.report.models[0]!.status, 'blocked');
  assert.equal(result.report.models[0]!.blockedReason, 'model-identity-unproven');
  assert.equal(result.report.models[1]!.status, 'failed');
  assert.equal(result.report.models[2]!.status, 'failed');
  assert.equal(result.report.models[3]!.status, 'failed');
  assert.equal(result.report.models[3]!.metrics.apiCalls, allRepairFixtures.length);
  assert.equal(getterReads, 0);
  assert.equal(result.report.models[4]!.status, 'passed');
  await rm(root, { recursive: true, force: true });
});

test('strict schemas reject output-bearing report fields and interrupted publication leaves prior report', async () => {
  assert.equal(PhaseAModelResultSchema.safeParse({ provider: 'p', model: 'm', status: 'blocked', blockedReason: 'blocked-no-zero-tool-seam', metrics: { fixtures: 0, positives: 0, negatives: 0, positivesAccepted: 0, negativesRefused: 0, positiveAcceptancePercent: 100, negativeRefusalPercent: 100, apiCalls: 0, toolCalls: 0 }, stdout: 'secret' }).success, false);
  const root = await mkdtemp(join(tmpdir(), 'phase-a-'));
  const report = { kind: 'reconciliation-phase-a-repair-report' as const, version: 1 as const, status: 'blocked' as const, models: [{ provider: 'p', model: 'm', status: 'blocked' as const, blockedReason: 'blocked-no-context-isolation' as const, metrics: { fixtures: 0, positives: 0, negatives: 0, positivesAccepted: 0, negativesRefused: 0, positiveAcceptancePercent: 100, negativeRefusalPercent: 100, apiCalls: 0, toolCalls: 0 as const } }], fixtureIds: [], positives: 0, negatives: 0 };
  await publishPhaseAReport(root, report);
  const before = await readFile(join(root, 'phase-a-report.json'), 'utf8');
  const markdownBefore = await readFile(join(root, 'phase-a-report.md'), 'utf8');
  const failed = { ...report, status: 'failed' as const, models: [{ ...report.models[0]!, status: 'failed' as const, blockedReason: undefined }] };
  await assert.rejects(publishPhaseAReport(root, failed, { interrupted: true }));
  assert.equal(await readFile(join(root, 'phase-a-report.json'), 'utf8'), before);
  assert.equal(await readFile(join(root, 'phase-a-report.md'), 'utf8'), markdownBefore);
  assert.equal((await readdir(root)).some((name) => name.includes('.tmp-')), false);
  let calls = 0;
  await assert.rejects(runPhaseABakeoff({ scratchRoot: root, adapters: [{ identity: { provider: 'p', model: 'fresh' }, invoke: async () => { calls += 1; throw new Error('must not run'); } }] }));
  assert.equal(calls, 0);
  assert.equal(PhaseARepairReportSchema.safeParse(report).success, true);
  await rm(root, { recursive: true, force: true });
});

test('process adapter owns a bounded executable lifecycle and receipt matrix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-process-'));
  const executable = join(root, 'fixture-process.mjs');
  await writeFile(executable, `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const mode = process.argv[2];
const good = { stdout: JSON.stringify({ repairable: false, reason: 'incomplete-original' }), usage: { provider: 'synthetic', model: mode, inputTokens: null, outputTokens: null, apiCalls: 1, toolAvailability: 'none', toolCalls: 0 } };
if (mode === 'success') { process.stdout.write(JSON.stringify(good)); process.exit(0); }
else if (mode === 'invalid') { process.stdout.write('{not-json'); process.exit(0); }
else if (mode === 'wrong') { process.stdout.write(JSON.stringify({ ...good, usage: { ...good.usage, provider: 'other' } })); process.exit(0); }
else if (mode === 'tool') { process.stdout.write(JSON.stringify({ ...good, usage: { ...good.usage, toolCalls: 1 } })); process.exit(0); }
else if (mode === 'overflow') { process.stdout.write(JSON.stringify({ ...good, stdout: 'x'.repeat(10000) })); process.exit(0); }
else if (mode === 'usage-overflow') { process.stdout.write(JSON.stringify({ ...good, usagePadding: 'x'.repeat(10000) })); process.exit(0); }
else if (mode === 'timeout') {
  process.on('SIGTERM', () => {});
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
  writeFileSync('timeout-pids.json', JSON.stringify([process.pid, child.pid]));
  setInterval(() => {}, 1000);
}
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  const invoke = (mode: string, timeoutMs = 200) => createProcessFormatterAdapter({ identity: { provider: 'synthetic', model: mode }, executable, args: [mode] }).invoke({ prompt: 'fixture', timeoutMs, maxOutputBytes: 2048, scratchDir: root, signal: new AbortController().signal });
  const success = await invoke('success'); assert.equal(success.usage.apiCalls, 1);
  for (const mode of ['invalid', 'overflow', 'usage-overflow', 'timeout']) await assert.rejects(invoke(mode));
  const timeoutPids = JSON.parse(await readFile(join(root, 'timeout-pids.json'), 'utf8')) as number[];
  for (const pid of timeoutPids) assert.throws(
    () => process.kill(pid, 0),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH',
    `process ${pid} must be gone`,
  );
  const boundedRoot = await mkdtemp(join(tmpdir(), 'phase-a-bounded-'));
  const fixture = allRepairFixtures.find((item) => item.expectedUnrepairableReason === 'incomplete-original')!;
  const make = (mode: string): FormatterAdapter => createProcessFormatterAdapter({ identity: { provider: 'synthetic', model: mode }, executable, args: [mode] });
  const result = await runPhaseABakeoff({ scratchRoot: boundedRoot, adapters: [make('wrong'), make('tool'), make('success')], fixtures: [fixture] });
  assert.equal(result.report.models[0]!.status, 'blocked'); assert.equal(result.report.models[0]!.blockedReason, 'model-identity-unproven');
  assert.equal(result.report.models[1]!.status, 'blocked'); assert.equal(result.report.models[1]!.blockedReason, 'blocked-no-zero-tool-seam'); assert.equal(result.report.models[2]!.status, 'passed');
  await rm(root, { recursive: true, force: true }); await rm(boundedRoot, { recursive: true, force: true });
});
