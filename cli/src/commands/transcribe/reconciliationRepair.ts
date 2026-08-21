import { z } from 'zod';

export const REPAIR_VERSION = 1 as const;
export const REPAIR_PROMPT_VERSION = 'reconciliation.format-repair.v1' as const;
export const MAX_REPAIR_OUTPUT_BYTES = 2_000_000;
export const MAX_REPAIR_ISSUES = 32;
export const MAX_REPAIR_PATH_DEPTH = 16;
export const MAX_REPAIR_LEXICAL_TOKENS = 8_192;
export const MAX_REPAIR_LEXICAL_TOKEN_CHARS = 20_000;

const MAX_REPAIR_STRING_CHARS = 256;
const MAX_REPAIR_ENUM_VALUES = 32;
const MAX_PROTECTION_COLLECTION_SIZE = 256;
const MAX_PROTECTION_TOTAL_NODES = 16_384;

const boundedString = z.string().max(MAX_REPAIR_STRING_CHARS);
const scalarSchema = z.union([boundedString, z.number().finite(), z.boolean(), z.null()]);
const pathSegmentSchema = z.union([
  boundedString,
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
]);
const pathSchema = z.array(pathSegmentSchema).max(MAX_REPAIR_PATH_DEPTH);

function boundedJsonSchema(depth: number): z.ZodType {
  if (depth === 0) return scalarSchema;
  const value = boundedJsonSchema(depth - 1);
  return z.union([
    scalarSchema,
    z.array(value).max(MAX_PROTECTION_COLLECTION_SIZE),
    z.record(boundedString, value).refine((record: Record<string, unknown>) => Object.keys(record).length <= MAX_PROTECTION_COLLECTION_SIZE),
  ]);
}

function hasBoundedNodeCount(value: unknown): boolean {
  let count = 0;
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    count += 1;
    if (count > MAX_PROTECTION_TOTAL_NODES) return false;
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current !== null && typeof current === 'object') {
      pending.push(...Object.values(current));
    }
  }
  return true;
}

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const protectionValueSchema = z.record(boundedString, boundedJsonSchema(4))
  .refine((record: Record<string, unknown>) => Object.keys(record).length <= MAX_PROTECTION_COLLECTION_SIZE)
  .refine(hasBoundedNodeCount, { message: 'protected projection exceeds aggregate node limit' });

const ProjectionProtectionSchema = z.object({
  kind: z.literal('projection'),
  value: protectionValueSchema,
  digest: digestSchema,
}).strict();

export const LexicalTokenSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('string'),
    value: z.string().max(MAX_REPAIR_LEXICAL_TOKEN_CHARS),
  }).strict(),
  z.object({
    kind: z.literal('number'),
    value: z.string().max(MAX_REPAIR_LEXICAL_TOKEN_CHARS),
  }).strict(),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('null') }).strict(),
]);

export const LexicalInventorySchema = z.object({
  tokens: z.array(LexicalTokenSchema).max(MAX_REPAIR_LEXICAL_TOKENS),
}).strict();

const LexicalProtectionSchema = z.object({
  kind: z.literal('lexical'),
  value: LexicalInventorySchema,
  digest: digestSchema,
}).strict();

const RepairProtectionSchema = z.discriminatedUnion('kind', [
  ProjectionProtectionSchema,
  LexicalProtectionSchema,
]);

export const RepairClassificationSchema = z.enum([
  'repairable-format',
  'unrepairable-semantic',
  'unrepairable-incomplete',
  'unrepairable-identity',
  'unrepairable-security',
]);

export const RepairIssueCodeSchema = z.enum([
  'invalid-json',
  'invalid-enum-location',
  'unrecognized-key',
  'missing-empty-collection',
  'optional-field-presence',
  'invalid-escaping',
  'nonsemantic-framing',
]);

export const RepairIssueSchema = z.object({
  stage: z.enum(['schema', 'json', 'lexical']),
  code: RepairIssueCodeSchema,
  path: pathSchema,
  actualValue: scalarSchema,
  allowedValues: z.array(scalarSchema).min(1).max(MAX_REPAIR_ENUM_VALUES).optional(),
  sameValueAllowedAt: z.array(pathSchema).max(MAX_REPAIR_ENUM_VALUES).optional(),
}).strict();

export const RepairPayloadSchema = z.object({
  repairVersion: z.literal(REPAIR_VERSION),
  targetSchemaVersion: boundedString,
  originalOutput: z.string().max(MAX_REPAIR_OUTPUT_BYTES).superRefine((value, ctx) => {
    if (Buffer.byteLength(value, 'utf8') > MAX_REPAIR_OUTPUT_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'originalOutput exceeds UTF-8 byte limit' });
    }
  }),
  classification: RepairClassificationSchema,
  issues: z.array(RepairIssueSchema).max(MAX_REPAIR_ISSUES),
  protection: RepairProtectionSchema,
}).strict();

export const RepairUnrepairableReasonSchema = z.enum([
  'semantic-change-required',
  'incomplete-original',
  'identity-change-required',
  'unsupported-repair',
]);

export const RepairEnvelopeSchema = z.discriminatedUnion('repairable', [
  z.object({ repairable: z.literal(true), repairedOutput: z.json() }).strict(),
  z.object({ repairable: z.literal(false), reason: RepairUnrepairableReasonSchema }).strict(),
]);

export type RepairClassification = z.infer<typeof RepairClassificationSchema>;
export type RepairIssueCode = z.infer<typeof RepairIssueCodeSchema>;
export type RepairIssue = z.infer<typeof RepairIssueSchema>;
export type RepairPayload = z.infer<typeof RepairPayloadSchema>;
export type RepairEnvelope = z.infer<typeof RepairEnvelopeSchema>;
export type RepairUnrepairableReason = z.infer<typeof RepairUnrepairableReasonSchema>;
export type LexicalToken = z.infer<typeof LexicalTokenSchema>;
export type LexicalInventory = z.infer<typeof LexicalInventorySchema>;

export function assertRepairPayloadBytes(value: unknown): asserts value is RepairPayload {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, nestedValue) => {
      if (nestedValue === undefined || typeof nestedValue === 'function' || typeof nestedValue === 'symbol') {
        throw new TypeError('repair payload contains a non-JSON value');
      }
      return nestedValue;
    });
  } catch {
    throw new RangeError('repair payload is not JSON serializable');
  }
  if (serialized === undefined) {
    throw new RangeError('repair payload is not JSON serializable');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REPAIR_OUTPUT_BYTES) {
    throw new RangeError('repair payload exceeds UTF-8 byte limit');
  }
  RepairPayloadSchema.parse(value);
}
