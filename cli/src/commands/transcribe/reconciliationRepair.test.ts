import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_REPAIR_ISSUES,
  MAX_REPAIR_OUTPUT_BYTES,
  MAX_REPAIR_PATH_DEPTH,
  REPAIR_PROMPT_VERSION,
  REPAIR_VERSION,
  RepairClassificationSchema,
  RepairEnvelopeSchema,
  RepairIssueCodeSchema,
  RepairIssueSchema,
  RepairPayloadSchema,
  RepairUnrepairableReasonSchema,
  assertRepairPayloadBytes,
} from './reconciliationRepair.js';

const issue = {
  stage: 'schema',
  code: 'invalid-enum-location',
  path: ['blocks', 0, 'reviewFlags', 0],
  actualValue: 'unsupported-proper-noun',
  allowedValues: ['ambiguous-speaker'],
  sameValueAllowedAt: [['suspicionFlags']],
};

const payload = {
  repairVersion: REPAIR_VERSION,
  targetSchemaVersion: 'reconciliation.v1',
  originalOutput: '{}',
  classification: 'repairable-format',
  issues: [issue],
  protection: { kind: 'projection', value: {}, digest: '0'.repeat(64) },
};

test('exports the version, prompt, and bounded repair constants', () => {
  assert.equal(REPAIR_VERSION, 1);
  assert.equal(REPAIR_PROMPT_VERSION, 'reconciliation.format-repair.v1');
  assert.equal(MAX_REPAIR_OUTPUT_BYTES, 2_000_000);
  assert.equal(MAX_REPAIR_ISSUES, 32);
  assert.equal(MAX_REPAIR_PATH_DEPTH, 16);
});

test('accepts all five repair classifications and rejects other values', () => {
  for (const classification of [
    'repairable-format',
    'unrepairable-semantic',
    'unrepairable-incomplete',
    'unrepairable-identity',
    'unrepairable-security',
  ]) assert.equal(RepairClassificationSchema.safeParse(classification).success, true);
  assert.equal(RepairClassificationSchema.safeParse('repairable').success, false);
});

test('accepts exactly the seven issue codes', () => {
  for (const code of [
    'invalid-json',
    'invalid-enum-location',
    'unrecognized-key',
    'missing-empty-collection',
    'optional-field-presence',
    'invalid-escaping',
    'nonsemantic-framing',
  ]) assert.equal(RepairIssueCodeSchema.safeParse(code).success, true);
  assert.equal(RepairIssueCodeSchema.safeParse('semantic-error').success, false);
});

test('accepts the valid issue and rejects unknown issue keys and freeform reasons', () => {
  assert.equal(RepairIssueSchema.safeParse(issue).success, true);
  assert.equal(RepairIssueSchema.safeParse({ ...issue, extra: true }).success, false);
  assert.equal(RepairIssueSchema.safeParse({ ...issue, actualValue: { nested: true } }).success, false);
  assert.equal(RepairIssueSchema.safeParse({ ...issue, code: 'why it failed' }).success, false);
  assert.equal(RepairIssueSchema.safeParse({ ...issue, path: ['a'.repeat(257)] }).success, false);
});

test('enforces issue path depth, segments, allowed-value list, and issue-count bounds', () => {
  const tooDeep = { ...issue, path: Array.from({ length: MAX_REPAIR_PATH_DEPTH + 1 }, (_, i) => i) };
  assert.equal(RepairIssueSchema.safeParse(tooDeep).success, false);
  assert.equal(RepairIssueSchema.safeParse({ ...issue, path: [-1] }).success, false);
  assert.equal(RepairIssueSchema.safeParse({ ...issue, path: [1.5] }).success, false);
  assert.equal(RepairIssueSchema.safeParse({ ...issue, allowedValues: [] }).success, false);
  assert.equal(RepairIssueSchema.safeParse({ ...issue, sameValueAllowedAt: [['a', -1]] }).success, false);
  assert.equal(RepairPayloadSchema.safeParse({ ...payload, issues: Array(MAX_REPAIR_ISSUES + 1).fill(issue) }).success, false);
});

test('accepts the strict repair payload and rejects unknown keys and invalid original output', () => {
  assert.equal(RepairPayloadSchema.safeParse(payload).success, true);
  assert.equal(RepairPayloadSchema.safeParse({ ...payload, extra: true }).success, false);
  assert.equal(RepairPayloadSchema.safeParse({ ...payload, repairVersion: 2 }).success, false);
  assert.equal(RepairPayloadSchema.safeParse({ ...payload, originalOutput: 42 }).success, false);
  assert.equal(RepairPayloadSchema.safeParse({ ...payload, protection: { kind: 'projection', value: [], digest: '0'.repeat(64) } }).success, false);
  assert.equal(RepairPayloadSchema.safeParse({ ...payload, protection: { kind: 'projection', value: {}, digest: 'bad' } }).success, false);
  const aggregateOverflow = Object.fromEntries(Array.from({ length: 65 }, (_, branch) => [
    `branch-${branch}`,
    Array.from({ length: 256 }, () => true),
  ]));
  assert.equal(RepairPayloadSchema.safeParse({
    ...payload,
    protection: { kind: 'projection', value: aggregateOverflow, digest: '0'.repeat(64) },
  }).success, false);
});

test('uses UTF-8 bytes, not only JavaScript character count, for original output', () => {
  const multibyte = 'é'.repeat(MAX_REPAIR_OUTPUT_BYTES);
  assert.equal(RepairPayloadSchema.safeParse({ ...payload, originalOutput: multibyte }).success, false);
  assert.equal(RepairPayloadSchema.safeParse({ ...payload, originalOutput: '🙂'.repeat(100) }).success, true);
});

test('validates strict repaired and unrepairable envelopes', () => {
  assert.equal(RepairUnrepairableReasonSchema.safeParse('incomplete-original').success, true);
  assert.equal(RepairUnrepairableReasonSchema.safeParse('because it failed').success, false);
  assert.equal(RepairEnvelopeSchema.safeParse({ repairable: true, repairedOutput: { ok: true } }).success, true);
  assert.equal(RepairEnvelopeSchema.safeParse({ repairable: false, reason: 'semantic-change-required' }).success, true);
  for (const reason of ['incomplete-original', 'identity-change-required', 'unsupported-repair']) {
    assert.equal(RepairEnvelopeSchema.safeParse({ repairable: false, reason }).success, true);
  }
  assert.equal(RepairEnvelopeSchema.safeParse({ repairable: false, reason: 'because it failed' }).success, false);
  assert.equal(RepairEnvelopeSchema.safeParse({ repairable: true, repairedOutput: {}, extra: 1 }).success, false);
  assert.equal(RepairEnvelopeSchema.safeParse({ repairable: false, reason: 'semantic-change-required', repairedOutput: {} }).success, false);
  assert.equal(RepairEnvelopeSchema.safeParse({ repairable: true, repairedOutput: undefined }).success, false);
  assert.equal(RepairEnvelopeSchema.safeParse({ repairable: true, repairedOutput: () => undefined }).success, false);
});

test('accepts a bounded ordered lexical token inventory and rejects the string placeholder', () => {
  const lexical = {
    ...payload,
    protection: {
      kind: 'lexical',
      value: {
        tokens: [
          { kind: 'string', value: 'blocks' },
          { kind: 'number', value: '1.0' },
          { kind: 'boolean', value: true },
          { kind: 'null' },
        ],
      },
      digest: '0'.repeat(64),
    },
  };
  assert.equal(RepairPayloadSchema.safeParse(lexical).success, true);
  assert.equal(RepairPayloadSchema.safeParse({
    ...lexical,
    protection: { kind: 'lexical', value: 'blocks,1.0,true,null', digest: '0'.repeat(64) },
  }).success, false);
  assert.equal(RepairPayloadSchema.safeParse({
    ...lexical,
    protection: {
      ...lexical.protection,
      value: { tokens: [{ kind: 'number', value: 1 }] },
    },
  }).success, false);
});

test('assertRepairPayloadBytes rejects nonserializable and oversized payloads', () => {
  assert.doesNotThrow(() => assertRepairPayloadBytes(payload));
  assert.throws(() => assertRepairPayloadBytes({ ...payload, originalOutput: '🙂'.repeat(MAX_REPAIR_OUTPUT_BYTES) }));
  assert.throws(() => assertRepairPayloadBytes({ ...payload, originalOutput: undefined }));
  assert.throws(() => assertRepairPayloadBytes({ foo: 1 }));
  const cyclic: Record<string, unknown> = { ...payload };
  cyclic['cycle'] = cyclic;
  assert.throws(() => assertRepairPayloadBytes(cyclic));
});
