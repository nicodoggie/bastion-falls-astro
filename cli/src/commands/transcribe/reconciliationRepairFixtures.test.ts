import assert from 'node:assert/strict';
import test from 'node:test';
import { ReconciliationResponseSchema } from './reconciliation.js';
import {
  classifyRepairFailure,
  evaluateFormatRepair,
  type RepairFailureCategory,
} from './reconciliationRepair.js';
import {
  allRepairFixtures,
  positiveRepairFixtures,
  negativeRepairFixtures,
  RepairFixtureSchema,
} from './reconciliationRepairFixtures.js';

const packet = {
  schemaVersion: 'reconciliation.v1',
  promptVersion: 'synthetic-prompt',
  chunk: { id: 'chunk-synthetic-a', start: 0, end: 10 },
  cacheIdentity: { inputHash: 'hash-source-a', contextHash: 'hash-context-a' },
};
const events = [{ id: 'event-synthetic-a', text: 'Speaker A said hello.', start: 1, end: 2 }];
const validation = { packet, authoritativeSourceEvents: events } as any;

const parsedFixtureValue = (originalOutput: string): unknown => {
  try { return JSON.parse(originalOutput.replace(/^```json\n|\n```$/gu, '')); } catch { return undefined; }
};

test('fixture corpus has strict bounded records and unique IDs', () => {
  assert.ok(allRepairFixtures.length >= 10);
  assert.ok(allRepairFixtures.length <= 32);
  assert.equal(new Set(allRepairFixtures.map((fixture) => fixture.id)).size, allRepairFixtures.length);
  for (const fixture of allRepairFixtures) {
    assert.equal(RepairFixtureSchema.safeParse(fixture).success, true, fixture.id);
    assert.equal(RepairFixtureSchema.safeParse({ ...fixture, extra: true }).success, false, fixture.id);
  }
  assert.equal(RepairFixtureSchema.safeParse({ ...allRepairFixtures[0], expectedIssueCodes: ['invalid-json'], expectedRepairedOutput: undefined }).success, false);
  assert.equal(RepairFixtureSchema.safeParse({ ...allRepairFixtures[0], expectedRepairedOutput: () => undefined }).success, false);
});

test('positive fixtures classify exactly and accept only their exact injected result', async () => {
  for (const fixture of positiveRepairFixtures) {
    const parsedValue = parsedFixtureValue(fixture.originalOutput);
    let classification;
    if (parsedValue !== undefined && !fixture.originalOutput.startsWith('```json')) {
      const schema = ReconciliationResponseSchema.safeParse(parsedValue);
      assert.equal(schema.success, false, fixture.id);
      if (schema.success) continue;
      classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, parsedValue, zodIssues: schema.error.issues });
    } else {
      classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, parseError: new Error('synthetic parse failure') });
    }
    assert.equal(classification.classification, 'repairable-format', fixture.id);
    assert.deepEqual(classification.issues.map((issue) => issue.code), fixture.expectedIssueCodes, fixture.id);

    let calls = 0;
    const evaluation = await evaluateFormatRepair({
      originalOutput: fixture.originalOutput,
      validation,
      invoke: async () => { calls += 1; return JSON.stringify({ repairable: true, repairedOutput: fixture.expectedRepairedOutput }); },
    });
    assert.equal(calls, 1, fixture.id);
    assert.equal(evaluation.outcome, 'accepted', fixture.id);
    assert.equal(evaluation.protection?.kind, fixture.expectedIssueCodes.includes('invalid-json') ? 'lexical' : 'projection', fixture.id);
    assert.match(evaluation.protection!.digest, /^[0-9a-f]{64}$/u, fixture.id);
    assert.equal(evaluation.validation?.status, fixture.id === 'fixture-wrong-enum-location' ? 'needs_review' : 'valid', fixture.id);
    assert.deepEqual(evaluation.validation?.blocks[0]?.sourceEventIds, ['event-synthetic-a'], fixture.id);
    const { status: _validationStatus, ...validationShape } = evaluation.validation as any;
    assert.deepEqual(validationShape, fixture.expectedRepairedOutput, fixture.id);
    assert.deepEqual(evaluation.candidate, { ...fixture.expectedRepairedOutput as object, status: 'needs_review' }, fixture.id);
  }
});

test('negative fixtures exercise their named boundary and never formatter-accept', async () => {
  const categories: Record<string, RepairFailureCategory> = {
    'fixture-invented-source-id': 'unknown-event',
    'fixture-missing-event-accounting': 'missing-accounting',
    'fixture-identity-mismatch': 'identity-mismatch',
  };
  const expectedClassifications: Record<string, string> = {
    'fixture-invented-source-id': 'unrepairable-semantic',
    'fixture-missing-event-accounting': 'unrepairable-semantic',
    'fixture-changed-readable-text': 'repairable-format',
    'fixture-changed-summary-safe-text': 'repairable-format',
    'fixture-changed-correction': 'repairable-format',
    'fixture-changed-attribution': 'repairable-format',
    'fixture-truncated-object': 'unrepairable-incomplete',
    'fixture-empty-output': 'unrepairable-incomplete',
    'fixture-identity-mismatch': 'unrepairable-identity',
    'fixture-overlong-semantic': 'unrepairable-semantic',
  };
  const expectedZeroCallReasons: Record<string, string> = {
    'fixture-invented-source-id': 'authoritative validation failed',
    'fixture-missing-event-accounting': 'format repair is not eligible',
    'fixture-truncated-object': 'format repair is not eligible',
    'fixture-empty-output': 'format repair is not eligible',
    'fixture-identity-mismatch': 'original identity mismatch',
    'fixture-overlong-semantic': 'format repair is not eligible',
  };
  const base = positiveRepairFixtures.find((fixture) => fixture.id === 'fixture-allowlisted-status')!.expectedRepairedOutput as any;
  const semanticCandidates: Record<string, () => unknown> = {
    'fixture-changed-readable-text': () => ({ ...base, blocks: [{ ...base.blocks[0], text: 'Speaker B said hello.' }] }),
    'fixture-changed-summary-safe-text': () => ({ ...base, blocks: [{ ...base.blocks[0], summarySafeText: 'Speaker B said hello.' }] }),
    'fixture-changed-correction': () => {
      const original = JSON.parse(negativeRepairFixtures.find((fixture) => fixture.id === 'fixture-changed-correction')!.originalOutput);
      delete original.status;
      original.materialCorrections[0] = { ...original.materialCorrections[0], replacement: 'goodbye', evidence: ['evidence-invented'] };
      return original;
    },
    'fixture-changed-attribution': () => ({ ...base, blocks: [{ ...base.blocks[0], attributionBasis: ['inferred'] }] }),
  };

  for (const fixture of negativeRepairFixtures) {
    const parsedValue = parsedFixtureValue(fixture.originalOutput);
    let classification;
    const category = categories[fixture.id];
    if (category) classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, failureCategory: category });
    else if (parsedValue === undefined) classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, parseError: new Error('synthetic parse failure') });
    else {
      const schema = ReconciliationResponseSchema.safeParse(parsedValue);
      assert.equal(schema.success, false, fixture.id);
      if (schema.success) continue;
      classification = classifyRepairFailure({ originalOutput: fixture.originalOutput, parsedValue, zodIssues: schema.error.issues });
    }
    assert.deepEqual(classification.issues.map((issue) => issue.code), fixture.expectedIssueCodes, fixture.id);
    assert.equal(classification.classification, expectedClassifications[fixture.id], fixture.id);

    const maliciousCandidate = semanticCandidates[fixture.id];
    if (maliciousCandidate) {
      let maliciousCalls = 0;
      const malicious = await evaluateFormatRepair({
        originalOutput: fixture.originalOutput,
        validation,
        invoke: async () => { maliciousCalls += 1; return JSON.stringify({ repairable: true, repairedOutput: maliciousCandidate() }); },
      });
      assert.equal(maliciousCalls, 1, fixture.id);
      assert.equal(malicious.outcome, 'rejected', fixture.id);
      assert.equal(malicious.classification, 'repairable-format', fixture.id);
      assert.equal(malicious.reason, 'repair invocation or validation failed', fixture.id);

      let refusalCalls = 0;
      const refusal = await evaluateFormatRepair({
        originalOutput: fixture.originalOutput,
        validation,
        invoke: async () => { refusalCalls += 1; return JSON.stringify({ repairable: false, reason: fixture.expectedUnrepairableReason }); },
      });
      assert.equal(refusalCalls, 1, fixture.id);
      assert.equal(refusal.outcome, 'unrepairable', fixture.id);
      assert.equal(refusal.reason, fixture.expectedUnrepairableReason, fixture.id);
    } else {
      let calls = 0;
      const evaluation = await evaluateFormatRepair({
        originalOutput: fixture.originalOutput,
        validation,
        invoke: async () => { calls += 1; return JSON.stringify({ repairable: true, repairedOutput: {} }); },
      });
      assert.equal(calls, 0, fixture.id);
      assert.notEqual(evaluation.outcome, 'accepted', fixture.id);
      assert.ok(evaluation.classification.startsWith('unrepairable-'), fixture.id);
      assert.equal(evaluation.classification, expectedClassifications[fixture.id], fixture.id);
      assert.equal(evaluation.reason, expectedZeroCallReasons[fixture.id], fixture.id);
      assert.equal(evaluation.protection, undefined, fixture.id);
    }
  }
});
