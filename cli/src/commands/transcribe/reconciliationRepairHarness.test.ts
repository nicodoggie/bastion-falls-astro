import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { allRepairFixtures } from './reconciliationRepairFixtures.js';
import {
  createHermesOneShotFormatterAdapter,
  createProcessFormatterAdapter,
  type FormatterAdapter,
  PhaseAModelResultSchema,
  PhaseARepairReportSchema,
  phaseAModelRepairFixtures,
  publishPhaseAReport,
  runPhaseABakeoff,
} from './reconciliationRepairHarness.js';

function fixtureFromPrompt(prompt: string, fixtures = allRepairFixtures) {
  const payload = JSON.parse(prompt.split('fixture-payload=')[1]!) as { originalOutput?: unknown };
  const fixture = fixtures.find((item) => item.originalOutput === payload.originalOutput);
  assert.ok(fixture);
  return fixture;
}

test('runs canonical fixtures in order with identical prompts and publishes private metrics only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-'));
  const prompts: string[] = [];
  const adapter = (provider: string, model: string): FormatterAdapter => ({
    identity: { provider, model },
    async invoke(input) {
      prompts.push(input.prompt);
      const fixture = fixtureFromPrompt(input.prompt);
      const envelope = fixture.expectation === 'repair'
        ? { repairable: true, repairedOutput: fixture.expectedRepairedOutput }
        : { repairable: false, reason: fixture.expectedUnrepairableReason };
      return { stdout: JSON.stringify(envelope), usage: { provider, model, inputTokens: 1, outputTokens: 1, apiCalls: 1, toolAvailability: 'none', toolCalls: 0, safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: 'synthetic-session' } };
    },
  });
  const result = await runPhaseABakeoff({ scratchRoot: root, adapters: [adapter('p', 'm1'), adapter('p', 'm2')] });
  assert.equal(result.report.status, 'passed');
  assert.deepEqual(prompts.slice(0, phaseAModelRepairFixtures.length), prompts.slice(phaseAModelRepairFixtures.length));
  for (const prompt of prompts) {
    const payload = JSON.parse(prompt.split('fixture-payload=')[1]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ['classification', 'issueCodes', 'originalOutput']);
    for (const forbidden of ['expectation', 'expectedRepairedOutput', 'expectedUnrepairableReason', 'fixture-wrong-', 'fixture-invented-', 'fixture-changed-']) assert.equal(prompt.includes(forbidden), false);
  }
  assert.deepEqual(result.report.fixtureIds, phaseAModelRepairFixtures.map((fixture) => fixture.id));
  for (const id of ['fixture-changed-readable-text', 'fixture-changed-summary-safe-text', 'fixture-changed-correction', 'fixture-changed-attribution']) assert.equal(result.report.fixtureIds.includes(id), false);
  assert.equal(result.report.models[0]!.metrics.positiveAcceptancePercent, 100);
  assert.equal(result.report.models[0]!.metrics.negativeRefusalPercent, 100);
  const serialized = JSON.stringify(result.report);
  for (const fixture of allRepairFixtures) if (fixture.originalOutput.length > 0) assert.equal(serialized.includes(fixture.originalOutput), false);
  assert.equal(serialized.includes(root), false);
  const modelFiles = await readdir(join(root, 'model-0', 'results'));
  assert.equal(modelFiles.filter((name) => name.startsWith('candidate-')).length, phaseAModelRepairFixtures.filter((fixture) => fixture.expectation === 'repair').length);
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

test('derives identical non-oracular classifications for identical original inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-oracle-'));
  const pair = [
    allRepairFixtures.find((item) => item.id === 'fixture-allowlisted-status')!,
    allRepairFixtures.find((item) => item.id === 'fixture-changed-readable-text')!,
  ];
  const prompts: string[] = [];
  const adapter: FormatterAdapter = {
    identity: { provider: 'synthetic', model: 'oracle-check' },
    async invoke(input) {
      prompts.push(input.prompt);
      return { stdout: '{}', usage: { provider: 'synthetic', model: 'oracle-check', inputTokens: 1, outputTokens: 1, apiCalls: 1, toolAvailability: 'none', toolCalls: 0, safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: 'oracle-check' } };
    },
  };
  await runPhaseABakeoff({ scratchRoot: root, adapters: [adapter], fixtures: pair });
  const payloads = prompts.map((prompt) => JSON.parse(prompt.split('fixture-payload=')[1]!) as Record<string, unknown>);
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(payloads[0]?.['classification'], 'repairable-format');
  await rm(root, { recursive: true, force: true });
});

test('uses the last valid validator argument as authoritative and ignores assistant prose', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-validator-'));
  const fixtures = [
    allRepairFixtures.find((fixture) => fixture.id === 'fixture-wrong-enum-location')!,
    allRepairFixtures.find((fixture) => fixture.id === 'fixture-invented-source-id')!,
  ];
  const adapter: FormatterAdapter = {
    identity: { provider: 'synthetic', model: 'validator' },
    async invoke(input) {
      assert.ok(input.validateCandidate);
      const fixture = fixtureFromPrompt(input.prompt, fixtures);
      let toolCalls = 1;
      if (fixture.expectation === 'repair') {
        assert.equal((await input.validateCandidate({ repairable: true, repairedOutput: {} })).valid, false);
        toolCalls = 2;
        const candidate = { repairable: true as const, repairedOutput: structuredClone(fixture.expectedRepairedOutput) };
        assert.equal((await input.validateCandidate(candidate)).valid, true);
        (candidate.repairedOutput as Record<string, unknown>)['schemaVersion'] = 'mutated-after-validation';
      } else {
        assert.equal((await input.validateCandidate({ repairable: false, reason: fixture.expectedUnrepairableReason })).valid, true);
      }
      return {
        stdout: '{assistant prose is deliberately ignored}',
        usage: {
          provider: 'synthetic', model: 'validator', inputTokens: 1, outputTokens: 1,
          apiCalls: toolCalls + 1, toolAvailability: 'validator-only',
          availableTools: ['validate_repair_json'], toolCalls,
          safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none',
          inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true,
          sessionId: `validator-${fixture.id}`,
        },
      };
    },
  };
  const result = await runPhaseABakeoff({ scratchRoot: root, adapters: [adapter], fixtures });
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.models[0]!.metrics.toolCalls, 3);
  assert.equal(result.report.models[0]!.metrics.apiCalls, 5);
  assert.equal(result.report.models[0]!.metrics.firstSubmissionAccepted, 1);
  assert.equal(result.report.models[0]!.metrics.correctedSubmissionAccepted, 1);
  await rm(root, { recursive: true, force: true });
});

test('blocks impossible API accounting for validator calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-accounting-'));
  const fixture = allRepairFixtures.find((item) => item.id === 'fixture-wrong-enum-location')!;
  const adapter: FormatterAdapter = {
    identity: { provider: 'synthetic', model: 'impossible-accounting' },
    async invoke(input) {
      assert.ok(input.validateCandidate);
      await input.validateCandidate({ repairable: true, repairedOutput: {} });
      await input.validateCandidate({ repairable: true, repairedOutput: fixture.expectedRepairedOutput });
      return { stdout: '', usage: { provider: 'synthetic', model: 'impossible-accounting', inputTokens: 1, outputTokens: 1, apiCalls: 1, toolAvailability: 'validator-only', availableTools: ['validate_repair_json'], toolCalls: 2, safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: 'impossible-accounting' } };
    },
  };
  const result = await runPhaseABakeoff({ scratchRoot: root, adapters: [adapter], fixtures: [fixture] });
  assert.equal(result.report.models[0]!.status, 'blocked');
  assert.equal(result.report.models[0]!.blockedReason, 'blocked-no-validator-tool-seam');
  assert.equal(result.report.models[0]!.metrics.apiCalls, 1);
  assert.equal(result.report.models[0]!.metrics.toolCalls, 0);
  await rm(root, { recursive: true, force: true });
});

test('blocks identity and tool violations while continuing to later models', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-'));
  const violating: FormatterAdapter = {
    identity: { provider: 'requested', model: 'bad' },
    async invoke() { return { stdout: '{}', usage: { provider: 'actual', model: 'bad', inputTokens: null, outputTokens: null, apiCalls: 1, toolAvailability: 'none', toolCalls: 0, safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: 'synthetic-session' } }; },
  };
  const good: FormatterAdapter = {
    identity: { provider: 'requested', model: 'good' },
    async invoke(input) {
      const fixture = fixtureFromPrompt(input.prompt);
      return { stdout: JSON.stringify(fixture.expectation === 'repair' ? { repairable: true, repairedOutput: fixture.expectedRepairedOutput } : { repairable: false, reason: fixture.expectedUnrepairableReason }), usage: { provider: 'requested', model: 'good', inputTokens: null, outputTokens: null, apiCalls: 1, toolAvailability: 'none', toolCalls: 0, safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: 'synthetic-session' } };
    },
  };
  const failing: FormatterAdapter = {
    identity: { provider: 'requested', model: 'ordinary-failure' },
    async invoke() { return { stdout: '{}', usage: { provider: 'requested', model: 'ordinary-failure', inputTokens: null, outputTokens: null, apiCalls: 1, toolAvailability: 'none', toolCalls: 0, safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: 'synthetic-session' } }; },
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
  assert.equal(result.report.models[3]!.metrics.apiCalls, phaseAModelRepairFixtures.length);
  assert.equal(getterReads, 0);
  assert.equal(result.report.models[4]!.status, 'passed');
  await rm(root, { recursive: true, force: true });
});

test('strict schemas reject output-bearing report fields and interrupted publication leaves prior report', async () => {
  assert.equal(PhaseAModelResultSchema.safeParse({ provider: 'p', model: 'm', status: 'blocked', blockedReason: 'blocked-no-zero-tool-seam', metrics: { fixtures: 0, positives: 0, negatives: 0, positivesAccepted: 0, negativesRefused: 0, firstSubmissionAccepted: 0, correctedSubmissionAccepted: 0, positiveAcceptancePercent: 100, negativeRefusalPercent: 100, apiCalls: 0, toolCalls: 0, safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: 'synthetic-session' }, stdout: 'secret' }).success, false);
  const root = await mkdtemp(join(tmpdir(), 'phase-a-'));
  const report = { kind: 'reconciliation-phase-a-repair-report' as const, version: 1 as const, status: 'blocked' as const, models: [{ provider: 'p', model: 'm', status: 'blocked' as const, blockedReason: 'blocked-no-context-isolation' as const, metrics: { fixtures: 0, positives: 0, negatives: 0, positivesAccepted: 0, negativesRefused: 0, firstSubmissionAccepted: 0, correctedSubmissionAccepted: 0, positiveAcceptancePercent: 100, negativeRefusalPercent: 100, apiCalls: 0, toolCalls: 0 } }], fixtureIds: [], positives: 0, negatives: 0 };
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
const good = { stdout: JSON.stringify({ repairable: false, reason: 'incomplete-original' }), usage: { provider: 'synthetic', model: mode, inputTokens: null, outputTokens: null, apiCalls: 1, toolAvailability: 'none', toolCalls: 0, safeMode: true, userConfigIgnored: true, rulesIgnored: true, profile: 'none', inlinePrompt: true, cwdIsolated: true, environmentAllowlisted: true, sessionId: 'synthetic-session' } };
if (mode === 'success') { process.stdout.write(JSON.stringify(good)); process.exit(0); }
else if (mode === 'env') { if (process.env.PROJECT_SECRET) process.exit(23); process.stdout.write(JSON.stringify(good)); process.exit(0); }
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
else if (mode === 'leader-exits') {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
  writeFileSync('leader-exits-pids.json', JSON.stringify([process.pid, child.pid]));
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
}
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  const invoke = (mode: string, timeoutMs = 200) => createProcessFormatterAdapter({ identity: { provider: 'synthetic', model: mode }, executable, args: [mode] }).invoke({ prompt: 'fixture', timeoutMs, maxOutputBytes: 2048, scratchDir: root, signal: new AbortController().signal });
  const success = await invoke('success'); assert.equal(success.usage.apiCalls, 1);
  const envSafe = await createProcessFormatterAdapter({ identity: { provider: 'synthetic', model: 'env' }, executable, args: ['env'], env: { ...process.env, PROJECT_SECRET: 'do-not-leak' } }).invoke({ prompt: 'fixture', timeoutMs: 200, maxOutputBytes: 2048, scratchDir: root, signal: new AbortController().signal }); assert.equal(envSafe.usage.model, 'env');
  for (const mode of ['invalid', 'overflow', 'usage-overflow', 'timeout', 'leader-exits']) await assert.rejects(invoke(mode, mode === 'leader-exits' ? 100 : 200));
  const timeoutPids = JSON.parse(await readFile(join(root, 'timeout-pids.json'), 'utf8')) as number[];
  for (const pid of timeoutPids) assert.throws(
    () => process.kill(pid, 0),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH',
    `process ${pid} must be gone`,
  );
  const leaderExitPids = JSON.parse(await readFile(join(root, 'leader-exits-pids.json'), 'utf8')) as number[];
  for (const pid of leaderExitPids) assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH', `process ${pid} must be gone`);
  const boundedRoot = await mkdtemp(join(tmpdir(), 'phase-a-bounded-'));
  const fixture = allRepairFixtures.find((item) => item.expectedUnrepairableReason === 'incomplete-original')!;
  const make = (mode: string): FormatterAdapter => createProcessFormatterAdapter({ identity: { provider: 'synthetic', model: mode }, executable, args: [mode] });
  const result = await runPhaseABakeoff({ scratchRoot: boundedRoot, adapters: [make('wrong'), make('tool'), make('success')], fixtures: [fixture] });
  assert.equal(result.report.models[0]!.status, 'blocked'); assert.equal(result.report.models[0]!.blockedReason, 'model-identity-unproven');
  assert.equal(result.report.models[1]!.status, 'blocked'); assert.equal(result.report.models[1]!.blockedReason, 'blocked-no-zero-tool-seam'); assert.equal(result.report.models[2]!.status, 'passed');
  await rm(root, { recursive: true, force: true }); await rm(boundedRoot, { recursive: true, force: true });
});

test('Hermes one-shot adapter uses the exact zero-tool invocation and cleans its owner-only cwd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-hermes-'));
  const executable = join(root, 'fake-hermes.mjs');
  await writeFile(executable, `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
const [promptFlag, prompt, modelFlag, model, providerFlag, provider, usageFlag, usageFile, safeMode, toolFlag, toolset] = process.argv.slice(2);
if (promptFlag !== '-z' || modelFlag !== '-m' || providerFlag !== '--provider' || provider !== 'openai-codex' || usageFlag !== '--usage-file' || safeMode !== '--safe-mode' || toolFlag !== '-t' || toolset !== 'context_engine' || model !== 'gpt-test' || readdirSync(process.cwd()).length !== 0) process.exit(21);
if (process.env.PROJECT_SECRET || process.env.NODE_OPTIONS !== undefined || process.env.HERMES_PROFILE !== undefined) process.exit(22);
if (prompt === 'timeout') {
  process.on('SIGTERM', () => {});
  const marker = usageFile + '.descendant';
  spawn(process.execPath, ['-e', \`const fs=require('fs');process.on('SIGTERM',()=>{});setTimeout(()=>fs.writeFileSync(\${JSON.stringify(marker)},'survived'),500);setInterval(()=>{},1000)\`], { stdio: 'ignore' });
  setInterval(() => {}, 1000);
}
if (prompt === 'overflow') { process.stdout.write('x'.repeat(4096)); process.exit(0); }
writeFileSync(usageFile, JSON.stringify({ input_tokens: 2, output_tokens: 3, api_calls: 1, model, provider, session_id: 'session-test-123' }));
process.stdout.write(JSON.stringify({ repairable: false, reason: 'incomplete-original' }));
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  const adapter = createHermesOneShotFormatterAdapter({ executable, model: 'gpt-test', scratchDir: root });
  const result = await adapter.invoke({ prompt: 'inline prompt', timeoutMs: 500, maxOutputBytes: 2048, scratchDir: root, signal: new AbortController().signal });
  assert.equal(result.usage.provider, 'openai-codex');
  assert.equal(result.usage.model, 'gpt-test');
  assert.equal(result.usage.sessionId, 'session-test-123');
  assert.equal(result.usage.toolAvailability, 'none');
  assert.equal(result.usage.toolCalls, 0);
  for (const key of ['safeMode', 'userConfigIgnored', 'rulesIgnored', 'inlinePrompt', 'cwdIsolated', 'environmentAllowlisted']) assert.equal(result.usage[key as keyof typeof result.usage], true, key);
  assert.equal(result.usage.profile, 'none');
  await assert.rejects(adapter.invoke({ prompt: 'overflow', timeoutMs: 500, maxOutputBytes: 128, scratchDir: root, signal: new AbortController().signal }));
  await assert.rejects(adapter.invoke({ prompt: 'timeout', timeoutMs: 20, maxOutputBytes: 2048, scratchDir: root, signal: new AbortController().signal }));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 550));
  await assert.rejects(adapter.invoke({ prompt: 'inline prompt', timeoutMs: 500, maxOutputBytes: 2048, scratchDir: join(root, 'escaped'), signal: new AbortController().signal }), /mismatch|scratch|ENOENT/i);
  assert.deepEqual(await readdir(root), ['fake-hermes.mjs']);
  await rm(root, { recursive: true, force: true });
});

test('Hermes one-shot adapter rejects oversized prompts and malformed or missing usage receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase-a-hermes-bad-'));
  const executable = join(root, 'fake-hermes.mjs');
  await writeFile(executable, `#!/usr/bin/env node
import { symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
const prompt = process.argv[process.argv.indexOf('-z') + 1];
const usageFile = process.argv[process.argv.indexOf('--usage-file') + 1];
if (prompt === 'missing') process.stdout.write('{}');
else if (prompt === 'symlink') { unlinkSync(usageFile); symlinkSync('/dev/null', usageFile); process.stdout.write('{}'); }
else {
  if (prompt === 'rogue-cwd') writeFileSync('rogue.txt', 'x');
  writeFileSync(usageFile, prompt === 'malformed' ? '{bad' : JSON.stringify({ model: 'gpt-test' }));
  process.stdout.write('{}');
}
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  const adapter = createHermesOneShotFormatterAdapter({ executable, model: 'gpt-test', scratchDir: root });
  const invoke = (prompt: string, signal = new AbortController().signal) => adapter.invoke({ prompt, timeoutMs: 500, maxOutputBytes: 2048, scratchDir: root, signal });
  await assert.rejects(invoke('missing'));
  await assert.rejects(invoke('malformed'));
  await assert.rejects(invoke('symlink'));
  await assert.rejects(invoke('rogue-cwd'), /cwd/i);
  await assert.rejects(invoke('invalid-fields'), /provider|apiCalls|sessionId/i);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(invoke('x', aborted.signal), /aborted/i);
  assert.deepEqual(await readdir(root), ['fake-hermes.mjs']);
  await assert.rejects(createHermesOneShotFormatterAdapter({ executable, model: 'gpt-test', scratchDir: root }).invoke({ prompt: 'x'.repeat(65537), timeoutMs: 500, maxOutputBytes: 2048, scratchDir: root, signal: new AbortController().signal }), /prompt/i);
  await rm(root, { recursive: true, force: true });
});