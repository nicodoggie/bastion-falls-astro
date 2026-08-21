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
  classifyRepairFailure,
  inventoryInvalidJson,
  verifyLexicalPreservation,
} from './reconciliationRepair.js';
import { ReconciliationResponseSchema } from './reconciliation.js';

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

const validResponse = {
  schemaVersion: 'reconciliation.v1', promptVersion: 'prompt',
  chunk: { id: 'chunk-1', start: 0, end: 10 }, cacheIdentity: { inputHash: 'source', contextHash: 'context' },
  blocks: [{ id: 'b1', start: 1, end: 2, kind: 'dialogue', text: 'hello', summarySafeText: 'safe',
    characterConfidence: 'unknown', attributionBasis: ['explicit'], sourceEventIds: ['event-1'], reviewFlags: [] }],
  omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: 'valid', errors: [] },
};

test('classifies a known suspicion enum misplaced in reviewFlags from real Zod issues', () => {
  const parsedValue = { ...validResponse, blocks: [{ ...validResponse.blocks[0], reviewFlags: ['unsupported-proper-noun'] }] };
  const parsed = ReconciliationResponseSchema.safeParse(parsedValue);
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const result = classifyRepairFailure({ originalOutput: JSON.stringify(parsedValue), parsedValue, zodIssues: parsed.error.issues });
  assert.equal(result.classification, 'repairable-format');
  assert.deepEqual(result.issues, [{ stage: 'schema', code: 'invalid-enum-location', path: ['blocks', 0, 'reviewFlags', 0], actualValue: 'unsupported-proper-noun', allowedValues: ['ambiguous-speaker', 'unclear-words', 'possible-omission', 'attribution-uncertain', 'material-correction'], sameValueAllowedAt: [['suspicionFlags']] }]);
});

test('only status is an initially repairable top-level unrecognized key', () => {
  for (const key of ['status', 'untrusted']) {
    const parsedValue = { ...validResponse, [key]: 'valid' };
    const parsed = ReconciliationResponseSchema.safeParse(parsedValue);
    assert.equal(parsed.success, false);
    if (parsed.success) continue;
    const result = classifyRepairFailure({ originalOutput: JSON.stringify(parsedValue), parsedValue, zodIssues: parsed.error.issues });
    assert.equal(result.classification, key === 'status' ? 'repairable-format' : 'unrepairable-semantic');
    if (key === 'status') assert.deepEqual(result.issues[0], { stage: 'schema', code: 'unrecognized-key', path: ['status'], actualValue: 'valid' });
  }
});

test('classifies only complete schema-shape repairs and never drops a blocking issue', () => {
  for (const path of [
    ['reviewNotes'], ['suspicionFlags'], ['materialCorrections'], ['omissions'], ['summarySafety', 'errors'],
  ]) {
    const parsedValue: any = JSON.parse(JSON.stringify(validResponse));
    const owner = path.length === 1 ? parsedValue : parsedValue[path[0]!];
    delete owner[path[path.length - 1]!];
    const parsed = ReconciliationResponseSchema.safeParse(parsedValue);
    assert.equal(parsed.success, false);
    if (parsed.success) continue;
    const result = classifyRepairFailure({ originalOutput: 'redacted', parsedValue, zodIssues: parsed.error.issues });
    assert.equal(result.classification, 'repairable-format');
    assert.equal(result.issues[0]?.code, 'missing-empty-collection');
  }

  const optionalValue: any = JSON.parse(JSON.stringify(validResponse));
  optionalValue.blocks[0].channel = null;
  const optionalParsed = ReconciliationResponseSchema.safeParse(optionalValue);
  assert.equal(optionalParsed.success, false);
  if (!optionalParsed.success) {
    const result = classifyRepairFailure({ originalOutput: 'redacted', parsedValue: optionalValue, zodIssues: optionalParsed.error.issues });
    assert.equal(result.classification, 'repairable-format');
    assert.equal(result.issues[0]?.code, 'optional-field-presence');
  }

  const mixed = { ...validResponse, status: 'valid', untrusted: 'private-source-text' };
  const mixedParsed = ReconciliationResponseSchema.safeParse(mixed);
  assert.equal(mixedParsed.success, false);
  if (!mixedParsed.success) {
    assert.equal(classifyRepairFailure({ originalOutput: 'redacted', parsedValue: mixed, zodIssues: mixedParsed.error.issues }).classification, 'unrepairable-semantic');
  }
  const validation = classifyRepairFailure({ originalOutput: 'valid json', validationError: new Error('private evidence failure') });
  assert.equal(validation.classification, 'unrepairable-semantic');
  assert.deepEqual(validation.issues, []);
});

test('rejects malformed or oversized runtime classifier inputs without throwing native errors', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  const accessorValue: Record<string, unknown> = JSON.parse(JSON.stringify(validResponse));
  delete accessorValue['reviewNotes'];
  let accessorReads = 0;
  Object.defineProperty(accessorValue, 'promptVersion', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      if (accessorReads > 2) throw new Error('getter must never run');
      return 'prompt';
    },
  });
  const cases: unknown[] = [
    null,
    { originalOutput: 1 },
    { originalOutput: '{}', zodIssues: Array.from({ length: MAX_REPAIR_ISSUES + 1 }, () => ({ code: 'custom', path: [] })) },
    { originalOutput: '{}', parsedValue: cyclic, zodIssues: [{ code: 'custom', path: [] }] },
    { originalOutput: '{}', parsedValue: {}, zodIssues: [{ code: 'custom', path: [() => undefined] }] },
    { originalOutput: '{}', parsedValue: accessorValue, zodIssues: [{ code: 'invalid_type', path: ['reviewNotes'] }] },
  ];
  for (const value of cases) {
    assert.doesNotThrow(() => classifyRepairFailure(value as any));
    assert.equal(classifyRepairFailure(value as any).classification, 'unrepairable-security');
  }
});

test('keeps parse, semantic, and authoritative failures ineligible', () => {
  const repairableShape = { ...validResponse, status: 'valid' };
  const repairableShapeParse = ReconciliationResponseSchema.safeParse(repairableShape);
  assert.equal(repairableShapeParse.success, false);
  if (!repairableShapeParse.success) {
    const parseDominates = classifyRepairFailure({
      originalOutput: '{', parsedValue: repairableShape, parseError: '', zodIssues: repairableShapeParse.error.issues,
    });
    assert.equal(parseDominates.classification, 'unrepairable-incomplete');
    assert.equal(parseDominates.issues[0]?.code, 'invalid-json');
  }
  assert.equal(classifyRepairFailure({ originalOutput: '{secret}', parseError: new Error('private stack') }).classification, 'unrepairable-incomplete');
  const overlong = { ...validResponse, blocks: [{ ...validResponse.blocks[0], text: 'x'.repeat(20_001) }] };
  const parsed = ReconciliationResponseSchema.safeParse(overlong);
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.equal(classifyRepairFailure({ originalOutput: 'redacted', parsedValue: overlong, zodIssues: parsed.error.issues }).classification, 'unrepairable-semantic');
  for (const [failureCategory, classification] of [['unknown-event', 'unrepairable-semantic'], ['missing-accounting', 'unrepairable-semantic'], ['identity-mismatch', 'unrepairable-identity'], ['timeout', 'unrepairable-incomplete'], ['empty-output', 'unrepairable-incomplete'], ['source-security', 'unrepairable-security']] as const) {
    assert.equal(classifyRepairFailure({ originalOutput: '', failureCategory }).classification, classification);
  }
});

test('inventories bounded malformed JSON content without reordering tokens', () => {
  const result = inventoryInvalidJson('{"a":1 "b":1,"ok":true,"none":null}');
  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.deepEqual(result.inventory.tokens, [
    { kind: 'string', value: 'a' }, { kind: 'number', value: '1' },
    { kind: 'string', value: 'b' }, { kind: 'number', value: '1' },
    { kind: 'string', value: 'ok' }, { kind: 'boolean', value: true },
    { kind: 'string', value: 'none' }, { kind: 'null' },
  ]);
  assert.doesNotThrow(() => verifyLexicalPreservation(result.inventory, { a: 1, b: 1.0, ok: true, none: null }));
  assert.throws(() => verifyLexicalPreservation(result.inventory, { b: 1, a: 1.0, ok: true, none: null }));
  const nullInventory = inventoryInvalidJson('{"x":null}');
  assert.equal(nullInventory.complete, true);
  if (nullInventory.complete) {
    let getterReads = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'x', { enumerable: true, get: () => { getterReads += 1; return null; } });
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, '0', { enumerable: true, get: () => { getterReads += 1; return null; } });
    Object.defineProperty(accessorArray, 'length', { value: 1 });
    for (const repaired of [{ x: Number.NaN }, { toJSON: () => ({ x: null }) }, accessor, { x: accessorArray }]) {
      assert.throws(() => verifyLexicalPreservation(nullInventory.inventory, repaired));
    }
    assert.equal(getterReads, 0);
  }
});

test('removes only the known Hermes prefix and closed json fence', () => {
  const framed = inventoryInvalidJson('⚠️  Reached maximum iterations (3). Requesting summary...\n```json\n{"x":"line\\n\\u2603"}\n```');
  assert.equal(framed.complete, true);
  if (framed.complete) assert.deepEqual(framed.inventory.tokens, [
    { kind: 'string', value: 'x' }, { kind: 'string', value: 'line\n☃' },
  ]);
  assert.equal(inventoryInvalidJson('⚠️  Reached maximum iterations (3). Requesting summary...\r\n{"x":1}').complete, true);
  assert.equal(inventoryInvalidJson('notice\n{"x":1}').complete, false);
});

test('rejects incomplete lexical tokens, arbitrary prose, and bound violations', () => {
  for (const input of [
    '{"x":"unterminated}', '{"x":1e}', '{"x":-}', 'prose {"x":1}',
    '{"x":1,"y"', '{"x" 1}', '{"x":}', '{"x":1}{"y":2}', '[1,2]', '{"x":1 2}',
    '{"x":1,}', '{"x":[1,]}', '{"x":1\u0001}',
  ]) {
    assert.equal(inventoryInvalidJson(input).complete, false, input);
  }
  assert.equal(inventoryInvalidJson('{"x":1').complete, true);
  assert.equal(inventoryInvalidJson('{"x":[1 2]').complete, true);
  const escaped = JSON.stringify({ x: 'quote " slash \\ newline \n unicode ☃' });
  assert.equal(inventoryInvalidJson(escaped).complete, true);
  assert.equal(inventoryInvalidJson('{"x":' + '['.repeat(17) + '1' + ']'.repeat(17) + '}').complete, false);
  const exactNumbers = inventoryInvalidJson('{"x":[1,1.0,1e0]}');
  assert.equal(exactNumbers.complete, true);
  if (exactNumbers.complete) assert.deepEqual(exactNumbers.inventory.tokens.filter((token) => token.kind === 'number'), [
    { kind: 'number', value: '1' }, { kind: 'number', value: '1.0' }, { kind: 'number', value: '1e0' },
  ]);
  assert.equal(inventoryInvalidJson(`{"x":[${Array(8_193).fill('0').join(',')}]}`).complete, false);
  assert.equal(inventoryInvalidJson(`{"x":"${'a'.repeat(20_001)}"}`).complete, false);
});

test('parse failures become repairable only with complete lexical protection', () => {
  const eligible = classifyRepairFailure({ originalOutput: '{"x":1 "y":true}', parseError: new Error('bad json') });
  assert.equal(eligible.classification, 'repairable-format');
  assert.equal(eligible.protection?.kind, 'lexical');
  const ineligible = classifyRepairFailure({ originalOutput: '{"x":1e}', parseError: new Error('bad json') });
  assert.equal(ineligible.classification, 'unrepairable-incomplete');
  assert.equal(ineligible.protection, undefined);
});
