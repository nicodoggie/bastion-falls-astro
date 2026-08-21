import { z } from 'zod';
import {
  RepairIssueCodeSchema,
  RepairUnrepairableReasonSchema,
  type RepairIssueCode,
  type RepairUnrepairableReason,
} from './reconciliationRepair.js';

const MAX_FIXTURES = 32;
const MAX_ID_CHARS = 64;
const MAX_OUTPUT_CHARS = 200_000;
const boundedOutput = z.string().max(MAX_OUTPUT_CHARS);
const boundedExpectedOutput = z.json().refine((value) => JSON.stringify(value).length <= MAX_OUTPUT_CHARS, 'expected output exceeds fixture bound');

export const RepairFixtureSchema = z.object({
  id: z.string().min(1).max(MAX_ID_CHARS).regex(/^fixture-[a-z0-9-]+$/u),
  expectation: z.enum(['repair', 'unrepairable']),
  originalOutput: boundedOutput,
  expectedIssueCodes: z.array(RepairIssueCodeSchema).max(8),
  expectedRepairedOutput: boundedExpectedOutput.optional(),
  expectedUnrepairableReason: RepairUnrepairableReasonSchema.optional(),
}).strict().superRefine((fixture, ctx) => {
  if (fixture.expectation === 'repair') {
    if (fixture.expectedRepairedOutput === undefined) ctx.addIssue({ code: 'custom', path: ['expectedRepairedOutput'], message: 'repair fixtures require expectedRepairedOutput' });
    if (fixture.expectedUnrepairableReason !== undefined) ctx.addIssue({ code: 'custom', path: ['expectedUnrepairableReason'], message: 'repair fixtures cannot have an unrepairable reason' });
  } else {
    if (fixture.expectedRepairedOutput !== undefined) ctx.addIssue({ code: 'custom', path: ['expectedRepairedOutput'], message: 'unrepairable fixtures cannot have expectedRepairedOutput' });
    if (fixture.expectedUnrepairableReason === undefined) ctx.addIssue({ code: 'custom', path: ['expectedUnrepairableReason'], message: 'unrepairable fixtures require a closed reason' });
  }
});

export type RepairFixture = z.infer<typeof RepairFixtureSchema>;

const base = {
  schemaVersion: 'reconciliation.v1',
  promptVersion: 'synthetic-prompt',
  chunk: { id: 'chunk-synthetic-a', start: 0, end: 10 },
  cacheIdentity: { inputHash: 'hash-source-a', contextHash: 'hash-context-a' },
  blocks: [{ id: 'block-synthetic-a', start: 1, end: 2, kind: 'dialogue', text: 'Speaker A said hello.', summarySafeText: 'Speaker A said hello.', characterConfidence: 'unknown', attributionBasis: ['explicit'], sourceEventIds: ['event-synthetic-a'], reviewFlags: [] }],
  omissions: [],
  materialCorrections: [],
  suspicionFlags: [],
  reviewNotes: [],
  summarySafety: { status: 'valid', errors: [] },
};

const repaired = (value: unknown) => JSON.stringify(value);
const withChanges = (changes: Record<string, unknown>) => ({ ...base, ...changes });
const eligibleSemanticOriginal = repaired({ ...base, status: 'valid' });
const correctionBase = withChanges({ materialCorrections: [{ sourceEventId: 'event-synthetic-a', sourceForm: 'helo', replacement: 'hello', evidence: ['evidence-synthetic-a'] }] });
const positive = (id: string, originalOutput: string, expectedIssueCodes: RepairIssueCode[], expectedRepairedOutput: z.infer<typeof boundedExpectedOutput>): RepairFixture => ({ id, expectation: 'repair', originalOutput, expectedIssueCodes, expectedRepairedOutput });
const negative = (id: string, originalOutput: string, expectedUnrepairableReason: RepairUnrepairableReason, expectedIssueCodes: RepairIssueCode[] = []): RepairFixture => ({ id, expectation: 'unrepairable', originalOutput, expectedIssueCodes, expectedUnrepairableReason });

export const positiveRepairFixtures: readonly RepairFixture[] = [
  positive('fixture-wrong-enum-location', repaired(withChanges({ blocks: [{ ...base.blocks[0], reviewFlags: ['unsupported-proper-noun'] }] })), ['invalid-enum-location'], withChanges({ suspicionFlags: ['unsupported-proper-noun'] })),
  positive('fixture-allowlisted-status', repaired({ ...base, status: 'valid' }), ['unrecognized-key'], base),
  positive('fixture-missing-empty-collection', repaired(withChanges({ reviewNotes: undefined })).replace(',"reviewNotes":null', ''), ['missing-empty-collection'], base),
  positive('fixture-known-markdown-framing', `\`\`\`json\n${repaired(base)}\n\`\`\``, ['invalid-json'], base),
  positive('fixture-missing-comma', repaired(base).replace(',"promptVersion"', ' "promptVersion"'), ['invalid-json'], base),
  positive('fixture-recoverable-escaping', repaired(base).replace('Speaker A said hello.', '\\u0053peaker A said hello.').replace(',\"promptVersion\"', ' \"promptVersion\"'), ['invalid-json'], base),
  positive('fixture-optional-field-presence', repaired(withChanges({ blocks: [{ ...base.blocks[0], channel: null }] })), ['optional-field-presence'], base),
];

export const negativeRepairFixtures: readonly RepairFixture[] = [
  negative('fixture-invented-source-id', repaired(withChanges({ blocks: [{ ...base.blocks[0], sourceEventIds: ['event-invented'] }] })), 'semantic-change-required'),
  negative('fixture-missing-event-accounting', repaired(withChanges({ blocks: [{ ...base.blocks[0], sourceEventIds: [] }] })), 'semantic-change-required'),
  negative('fixture-changed-readable-text', eligibleSemanticOriginal, 'semantic-change-required', ['unrecognized-key']),
  negative('fixture-changed-summary-safe-text', eligibleSemanticOriginal, 'semantic-change-required', ['unrecognized-key']),
  negative('fixture-changed-correction', repaired({ ...correctionBase, status: 'valid' }), 'semantic-change-required', ['unrecognized-key']),
  negative('fixture-changed-attribution', eligibleSemanticOriginal, 'semantic-change-required', ['unrecognized-key']),
  negative('fixture-truncated-object', '{"schemaVersion":"reconciliation.v1","promptVersion":"synthetic', 'incomplete-original', ['invalid-json']),
  negative('fixture-empty-output', '', 'incomplete-original', ['invalid-json']),
  negative('fixture-identity-mismatch', repaired({ ...base, chunk: { ...base.chunk, id: 'chunk-invented' } }), 'identity-change-required'),
  negative('fixture-overlong-semantic', repaired(withChanges({ reviewNotes: ['x'.repeat(257)] })), 'semantic-change-required'),
];

export const allRepairFixtures: readonly RepairFixture[] = [...positiveRepairFixtures, ...negativeRepairFixtures];

const parsed = z.array(RepairFixtureSchema).max(MAX_FIXTURES).parse(allRepairFixtures);
if (new Set(parsed.map((fixture) => fixture.id)).size !== parsed.length) throw new Error('repair fixture IDs must be unique');
