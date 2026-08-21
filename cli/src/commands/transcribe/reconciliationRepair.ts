import { z } from 'zod';
import {
  CacheIdentitySchema,
  ChunkWindowSchema,
  MaterialCorrectionSchema,
  OmissionSchema,
  ReconciliationBlockSchema,
  ReconciliationResponseSchema,
  SummarySafetySchema,
} from './reconciliation.js';
import { stableHash } from './reconciliationEvidence.js';

export const REPAIR_VERSION = 1 as const;
export const REPAIR_PROMPT_VERSION = 'reconciliation.format-repair.v1' as const;
export const MAX_REPAIR_OUTPUT_BYTES = 2_000_000;
export const MAX_REPAIR_ISSUES = 32;
export const MAX_REPAIR_PATH_DEPTH = 16;
export const MAX_REPAIR_LEXICAL_TOKENS = 8_192;
export const MAX_REPAIR_LEXICAL_TOKEN_CHARS = 20_000;

const MAX_REPAIR_STRING_CHARS = 256;
const MAX_REPAIR_ENUM_VALUES = 32;
const MAX_PROTECTION_COLLECTION_SIZE = 2_048;
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

const repairFlagSchema = z.union([
  ReconciliationBlockSchema.shape.reviewFlags.element,
  ReconciliationResponseSchema.shape.suspicionFlags.element,
]);
const repairOptionalIdentifierSchema = z.preprocess(
  (value) => value === null || value === '' ? undefined : value,
  ReconciliationBlockSchema.shape.channel,
);
const projectionInputBlockSchema = ReconciliationBlockSchema.extend({
  channel: repairOptionalIdentifierSchema,
  physicalSpeaker: repairOptionalIdentifierSchema,
  characterCandidate: repairOptionalIdentifierSchema,
  reviewFlags: z.array(repairFlagSchema).max(8),
}).strict();
const projectionInputSummarySafetySchema = SummarySafetySchema.extend({
  errors: SummarySafetySchema.shape.errors.optional().default([]),
}).strict();
const projectionInputSchema = z.object({
  schemaVersion: ReconciliationResponseSchema.shape.schemaVersion,
  promptVersion: ReconciliationResponseSchema.shape.promptVersion,
  chunk: ChunkWindowSchema,
  cacheIdentity: CacheIdentitySchema,
  blocks: z.array(projectionInputBlockSchema).min(1).max(MAX_PROTECTION_COLLECTION_SIZE),
  omissions: ReconciliationResponseSchema.shape.omissions.optional().default([]),
  materialCorrections: ReconciliationResponseSchema.shape.materialCorrections.optional().default([]),
  suspicionFlags: z.array(repairFlagSchema).max(8).optional().default([]),
  reviewNotes: ReconciliationResponseSchema.shape.reviewNotes.optional().default([]),
  summarySafety: projectionInputSummarySafetySchema,
  status: z.json().optional(),
}).strict();

const protectedFlagSchema = z.object({ value: repairFlagSchema, count: z.number().int().positive() }).strict();
const protectedBlockSchema = ReconciliationBlockSchema.omit({ start: true, end: true, reviewFlags: true });
const protectedOmissionSchema = OmissionSchema.omit({ text: true, start: true, end: true });
const protectedCorrectionSchema = MaterialCorrectionSchema.omit({ sourceForm: true });

export const ProtectedProjectionSchema = z.object({
  schemaVersion: ReconciliationResponseSchema.shape.schemaVersion,
  promptVersion: ReconciliationResponseSchema.shape.promptVersion,
  chunk: ChunkWindowSchema,
  cacheIdentity: CacheIdentitySchema,
  blocks: z.array(protectedBlockSchema).min(1).max(MAX_PROTECTION_COLLECTION_SIZE),
  omissions: z.array(protectedOmissionSchema).max(MAX_PROTECTION_COLLECTION_SIZE),
  materialCorrections: z.array(protectedCorrectionSchema).max(MAX_PROTECTION_COLLECTION_SIZE),
  flags: z.array(protectedFlagSchema).max(MAX_PROTECTION_COLLECTION_SIZE),
  reviewNotes: ReconciliationResponseSchema.shape.reviewNotes,
  summarySafety: SummarySafetySchema,
}).strict();

export type ProtectedProjection = z.infer<typeof ProtectedProjectionSchema>;

function projectionError(message: string): never { throw new RangeError(`invalid protected projection: ${message}`); }

function flagRecords(values: string[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([value, count]) => ({ value, count }));
}

export function buildProtectedProjection(input: unknown): ProtectedProjection {
  const parsed = projectionInputSchema.safeParse(input);
  if (!parsed.success) projectionError('input does not match bounded reconciliation structure');
  const value = parsed.data;
  const flags = [...value.suspicionFlags];
  const blocks = value.blocks.map(({ start: _start, end: _end, reviewFlags, ...block }) => {
    flags.push(...reviewFlags);
    for (const key of ['channel', 'physicalSpeaker', 'characterCandidate'] as const) {
      if (block[key] === undefined) delete block[key];
    }
    return block;
  });
  const omissions = value.omissions.map(({ text: _text, start: _start, end: _end, ...omission }) => omission);
  const materialCorrections = value.materialCorrections.map(({ sourceForm: _sourceForm, ...correction }) => correction);
  const projection = {
    schemaVersion: value.schemaVersion,
    promptVersion: value.promptVersion,
    chunk: value.chunk,
    cacheIdentity: value.cacheIdentity,
    blocks,
    omissions,
    materialCorrections,
    flags: flagRecords(flags),
    reviewNotes: value.reviewNotes,
    summarySafety: value.summarySafety,
  };
  return ProtectedProjectionSchema.parse(projection);
}

export function protectedDigest(projection: ProtectedProjection): string {
  return stableHash(ProtectedProjectionSchema.parse(projection));
}

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

const repairFailureCategorySchema = z.enum([
  'unknown-event', 'missing-accounting', 'identity-mismatch', 'timeout', 'empty-output', 'source-security',
]);
export type RepairFailureCategory = z.infer<typeof repairFailureCategorySchema>;

const RepairClassificationResultSchema = z.object({
  classification: RepairClassificationSchema,
  issues: z.array(RepairIssueSchema).max(MAX_REPAIR_ISSUES),
}).strict();
export type RepairClassificationResult = z.infer<typeof RepairClassificationResultSchema>;

const MAX_CLASSIFICATION_JSON_DEPTH = 16;
const MAX_CLASSIFICATION_JSON_NODES = 65_536;

function securityClassification(): RepairClassificationResult {
  return RepairClassificationResultSchema.parse({ classification: 'unrepairable-security', issues: [] });
}

function isBoundedJson(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_CLASSIFICATION_JSON_NODES || current.depth > MAX_CLASSIFICATION_JSON_DEPTH) return false;
    if (current.value === null || typeof current.value === 'boolean' || typeof current.value === 'string') continue;
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (typeof current.value !== 'object') return false;
    if (seen.has(current.value)) return false;
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_PROTECTION_COLLECTION_SIZE) return false;
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (Object.getPrototypeOf(current.value) !== Object.prototype && Object.getPrototypeOf(current.value) !== null) return false;
    if (Object.getOwnPropertySymbols(current.value).length > 0) return false;
    const entries = Object.entries(Object.getOwnPropertyDescriptors(current.value));
    if (entries.length > MAX_PROTECTION_COLLECTION_SIZE) return false;
    for (const [key, descriptor] of entries) {
      if (key.length > MAX_REPAIR_STRING_CHARS) return false;
      if (!descriptor.enumerable || !('value' in descriptor)) return false;
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && Buffer.byteLength(serialized, 'utf8') <= MAX_REPAIR_OUTPUT_BYTES;
  } catch {
    return false;
  }
}

function isBoundedZodIssue(value: unknown): value is z.ZodIssue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const issue = value as Record<string, unknown>;
  if (typeof issue['code'] !== 'string' || issue['code'].length > MAX_REPAIR_STRING_CHARS) return false;
  if (!Array.isArray(issue['path']) || issue['path'].length > MAX_REPAIR_PATH_DEPTH) return false;
  if (!issue['path'].every((segment) => (
    typeof segment === 'string' ? segment.length <= MAX_REPAIR_STRING_CHARS
      : typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0
  ))) return false;
  if (issue['keys'] !== undefined && (
    !Array.isArray(issue['keys']) || issue['keys'].length > MAX_REPAIR_ISSUES
    || !issue['keys'].every((key) => typeof key === 'string' && key.length <= MAX_REPAIR_STRING_CHARS)
  )) return false;
  return true;
}

function admitRepairFailureInput(value: unknown): RepairFailureInput | undefined {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    if (typeof input['originalOutput'] !== 'string'
      || Buffer.byteLength(input['originalOutput'], 'utf8') > MAX_REPAIR_OUTPUT_BYTES) return undefined;
    if (input['failureCategory'] !== undefined && !repairFailureCategorySchema.safeParse(input['failureCategory']).success) return undefined;
    if (input['failureCategory'] !== undefined || input['parseError'] !== undefined) return input as unknown as RepairFailureInput;
    if (input['zodIssues'] !== undefined) {
      if (!Array.isArray(input['zodIssues']) || input['zodIssues'].length > MAX_REPAIR_ISSUES
        || !input['zodIssues'].every(isBoundedZodIssue)) return undefined;
      if (input['parsedValue'] !== undefined && !isBoundedJson(input['parsedValue'])) return undefined;
    }
    return input as unknown as RepairFailureInput;
  } catch {
    return undefined;
  }
}

export interface RepairFailureInput {
  originalOutput: string;
  parsedValue?: unknown;
  parseError?: unknown;
  zodIssues?: readonly z.ZodIssue[];
  validationError?: unknown;
  failureCategory?: RepairFailureCategory;
}

const reviewFlagValues = ['ambiguous-speaker', 'unclear-words', 'possible-omission', 'attribution-uncertain', 'material-correction'] as const;
const suspicionFlagValues = ['high-omitted-ratio', 'large-compression', 'decoder-loop-range', 'expected-character-only', 'unsupported-proper-noun', 'unexplained-silence', 'reordered-source-events'] as const;
const emptyCollectionPaths = new Set(['reviewNotes', 'suspicionFlags', 'materialCorrections', 'omissions', 'summarySafety.errors']);
const optionalProjectionPaths = new Set(['channel', 'physicalSpeaker', 'characterCandidate']);

function valueAtPath(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function safeScalar(value: unknown): z.infer<typeof scalarSchema> {
  return scalarSchema.safeParse(value).success ? value as z.infer<typeof scalarSchema> : null;
}

function sameProtectedProjection(left: unknown, right: unknown): boolean {
  try { return protectedDigest(buildProtectedProjection(left)) === protectedDigest(buildProtectedProjection(right)); } catch { return false; }
}

function withEmptyCollection(value: unknown, path: readonly PropertyKey[]): unknown {
  if (value === null || typeof value !== 'object') return value;
  const copy = structuredClone(value) as Record<string, unknown>;
  let cursor: Record<string, unknown> = copy;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = String(path[index]);
    if (cursor[key] === null || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) return value;
    cursor[key] = { ...(cursor[key] as Record<string, unknown>) };
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[String(path[path.length - 1])] = [];
  return copy;
}

function withoutPath(value: unknown, path: readonly PropertyKey[]): unknown {
  if (value === null || typeof value !== 'object') return value;
  const copy = structuredClone(value) as Record<string, unknown>;
  let cursor: Record<string, unknown> = copy;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = String(path[index]);
    if (cursor[key] === null || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) return value;
    cursor = cursor[key] as Record<string, unknown>;
  }
  delete cursor[String(path[path.length - 1])];
  return copy;
}

function normalizedIssue(issue: z.ZodIssue, parsedValue: unknown): RepairIssue | undefined {
  const path = issue.path.filter((segment): segment is string | number => typeof segment === 'string' || (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0));
  if (path.length !== issue.path.length || path.length > MAX_REPAIR_PATH_DEPTH) return undefined;
  if (issue.code === 'invalid_value' && path.length >= 3 && path[0] === 'blocks' && path[2] === 'reviewFlags') {
    const actual = safeScalar(valueAtPath(parsedValue, path));
    if (typeof actual !== 'string' || !(suspicionFlagValues as readonly string[]).includes(actual)) return undefined;
    return { stage: 'schema', code: 'invalid-enum-location', path, actualValue: actual, allowedValues: [...reviewFlagValues], sameValueAllowedAt: [['suspicionFlags']] };
  }
  if (issue.code === 'unrecognized_keys' && path.length === 0 && issue.keys?.length === 1 && issue.keys[0] === 'status') {
    const status = valueAtPath(parsedValue, ['status']);
    const safeStatus = typeof status === 'string' && ['valid', 'pending', 'needs_review', 'invalid'].includes(status) ? status : null;
    return { stage: 'schema', code: 'unrecognized-key', path: ['status'], actualValue: safeStatus };
  }
  if (issue.code === 'invalid_type' && path.length > 0) {
    const key = path.join('.');
    if (emptyCollectionPaths.has(key) && sameProtectedProjection(parsedValue, withEmptyCollection(parsedValue, path))) {
      return { stage: 'schema', code: 'missing-empty-collection', path, actualValue: null, sameValueAllowedAt: [path] };
    }
    if (optionalProjectionPaths.has(String(path[path.length - 1])) && sameProtectedProjection(parsedValue, withoutPath(parsedValue, path))) {
      return { stage: 'schema', code: 'optional-field-presence', path, actualValue: safeScalar(valueAtPath(parsedValue, path)) };
    }
  }
  return undefined;
}

export function classifyRepairFailure(input: RepairFailureInput): RepairClassificationResult {
  const admitted = admitRepairFailureInput(input);
  if (!admitted) return securityClassification();
  input = admitted;
  let classification: RepairClassification = 'unrepairable-incomplete';
  let issues: RepairIssue[] = [];
  if (input.failureCategory) {
    classification = input.failureCategory === 'identity-mismatch' ? 'unrepairable-identity' : input.failureCategory === 'source-security' ? 'unrepairable-security' : input.failureCategory === 'unknown-event' || input.failureCategory === 'missing-accounting' ? 'unrepairable-semantic' : 'unrepairable-incomplete';
  } else if (input.parseError !== undefined) {
    classification = 'unrepairable-incomplete';
    issues = [{ stage: 'json', code: 'invalid-json', path: [], actualValue: null }];
  } else if (input.zodIssues && input.zodIssues.length > 0) {
    issues = input.zodIssues.map((issue) => normalizedIssue(issue, input.parsedValue)).filter((issue): issue is RepairIssue => issue !== undefined).slice(0, MAX_REPAIR_ISSUES);
    const hasOverlong = input.zodIssues.some((issue) => issue.code === 'too_big' && issue.path.length > 0);
    if (hasOverlong) classification = 'unrepairable-semantic';
    else if (issues.length === input.zodIssues.length && issues.length > 0 && issues.every((issue) => issue.code === 'invalid-enum-location' || issue.code === 'unrecognized-key' || issue.code === 'missing-empty-collection' || issue.code === 'optional-field-presence')) classification = 'repairable-format';
    else classification = 'unrepairable-semantic';
  } else if (input.validationError !== undefined) {
    classification = 'unrepairable-semantic';
  }
  return RepairClassificationResultSchema.parse({ classification, issues });
}

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
