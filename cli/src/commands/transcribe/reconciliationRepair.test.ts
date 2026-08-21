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
  buildProtectedProjection,
  protectedDigest,
  ProtectedProjectionSchema,
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

const protectedFixture = {
  schemaVersion: 'reconciliation.v1', promptVersion: 'prompt',
  chunk: { id: 'chunk-1', start: 0, end: 10 }, cacheIdentity: { inputHash: 'source', contextHash: 'context' },
  blocks: [{ id: 'b1', start: 1, end: 2, kind: 'dialogue', text: 'hello', summarySafeText: 'safe',
    channel: 'left', physicalSpeaker: 'voice-a', characterCandidate: 'Hero', characterConfidence: 'confirmed',
    attributionBasis: ['explicit'], sourceEventIds: ['event-1'], reviewFlags: ['unsupported-proper-noun'] }],
  omissions: [{ sourceEventId: 'event-2', text: 'omitted', start: 2, end: 3, reason: 'decoder-loop' }],
  materialCorrections: [{ sourceEventId: 'event-1', sourceForm: 'helo', replacement: 'hello', evidence: ['rule-1'] }],
  suspicionFlags: ['high-omitted-ratio'], reviewNotes: ['check me'], summarySafety: { status: 'valid', errors: [] },
  status: 'valid',
};

function protectedDigestOf(value: unknown): string {
  return protectedDigest(buildProtectedProjection(value));
}

test('protects semantic projections while ignoring deterministic echoes and framing', () => {
  const reordered = JSON.parse(JSON.stringify(protectedFixture));
  reordered.blocks[0] = Object.fromEntries(Object.entries(reordered.blocks[0]).reverse());
  assert.deepEqual(buildProtectedProjection(protectedFixture), buildProtectedProjection(reordered));
  assert.equal(protectedDigestOf(protectedFixture), protectedDigestOf(reordered));
  assert.throws(() => protectedDigestOf({ ...protectedFixture, schemaVersion: 'other' }));
  for (const mutation of [
    (x: any) => { x.promptVersion = 'other'; },
    (x: any) => { x.chunk.id = 'chunk-2'; },
    (x: any) => { x.chunk.start = 1; },
    (x: any) => { x.cacheIdentity.contextHash = 'other'; },
    (x: any) => { x.blocks[0].id = 'b2'; },
    (x: any) => { x.blocks[0].kind = 'narration'; },
    (x: any) => { x.blocks[0].text = 'changed'; },
    (x: any) => { x.blocks[0].summarySafeText = 'changed'; },
    (x: any) => { x.blocks[0].channel = 'right'; },
    (x: any) => { x.blocks[0].physicalSpeaker = 'voice-b'; },
    (x: any) => { x.blocks[0].characterCandidate = 'Villain'; },
    (x: any) => { x.blocks[0].characterConfidence = 'probable'; },
    (x: any) => { x.blocks[0].attributionBasis = ['inferred']; },
    (x: any) => { x.blocks[0].sourceEventIds = ['event-9']; },
    (x: any) => { x.omissions[0].reason = 'duplicate'; },
    (x: any) => { x.omissions[0].sourceEventId = 'event-9'; },
    (x: any) => { x.materialCorrections[0].replacement = 'different'; },
    (x: any) => { x.materialCorrections[0].evidence = ['other']; },
    (x: any) => { x.reviewNotes = ['different']; },
    (x: any) => { x.summarySafety = { status: 'pending', errors: ['pending'] }; },
  ]) {
    const changed = JSON.parse(JSON.stringify(protectedFixture)); mutation(changed);
    assert.notEqual(protectedDigestOf(protectedFixture), protectedDigestOf(changed));
  }
  for (const mutation of [
    (x: any) => { x.blocks[0].start = 99; }, (x: any) => { x.blocks[0].end = 99; },
    (x: any) => { x.omissions[0].text = 'new text'; }, (x: any) => { x.omissions[0].start = 99; },
    (x: any) => { x.omissions[0].end = 99; }, (x: any) => { x.materialCorrections[0].sourceForm = 'other'; },
    (x: any) => { x.status = 'needs_review'; },
  ]) {
    const equivalent = JSON.parse(JSON.stringify(protectedFixture)); mutation(equivalent);
    assert.equal(protectedDigestOf(protectedFixture), protectedDigestOf(equivalent));
  }
});

test('canonicalizes relocated flags by value and preserves multiplicity', () => {
  const relocated = JSON.parse(JSON.stringify(protectedFixture));
  relocated.blocks[0].reviewFlags = [];
  relocated.suspicionFlags.push('unsupported-proper-noun');
  assert.equal(protectedDigestOf(protectedFixture), protectedDigestOf(relocated));
  for (const mutate of [
    (x: any) => { x.suspicionFlags.push('large-compression'); },
    (x: any) => { x.blocks[0].reviewFlags = []; },
    (x: any) => { x.suspicionFlags.push('unsupported-proper-noun'); },
  ]) {
    const changed = JSON.parse(JSON.stringify(protectedFixture)); mutate(changed);
    assert.notEqual(protectedDigestOf(protectedFixture), protectedDigestOf(changed));
  }
});

test('accepts schema-approved missing/empty equivalents and rejects unknown or malformed runtime inputs', () => {
  const emptyEquivalent = JSON.parse(JSON.stringify(protectedFixture));
  emptyEquivalent.reviewNotes = [];
  const withoutEmpty = JSON.parse(JSON.stringify(protectedFixture));
  delete withoutEmpty.reviewNotes;
  assert.equal(protectedDigestOf(emptyEquivalent), protectedDigestOf(withoutEmpty));
  const longReadable = JSON.parse(JSON.stringify(protectedFixture));
  longReadable.blocks[0].text = 'x'.repeat(257);
  assert.doesNotThrow(() => buildProtectedProjection(longReadable));
  assert.equal(ProtectedProjectionSchema.safeParse(buildProtectedProjection(protectedFixture)).success, true);
  for (const value of [null, [], 'text', 1, { ...protectedFixture, unknown: true }, { ...protectedFixture, blocks: [{ ...protectedFixture.blocks[0], unknown: true }] }, { ...protectedFixture, blocks: 'bad' }]) {
    assert.throws(() => buildProtectedProjection(value), (error: unknown) => !(error instanceof TypeError));
  }
});
