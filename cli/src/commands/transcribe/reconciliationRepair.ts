import { z } from 'zod';
import {
  CacheIdentitySchema,
  ChunkWindowSchema,
  MaterialCorrectionSchema,
  OmissionSchema,
  ReconciliationBlockSchema,
  ReconciliationResponseSchema,
  SourceEventSchema,
  SummarySafetySchema,
} from './reconciliation.js';
import { stableHash } from './reconciliationEvidence.js';
import type { ReconciliationEvidencePacket } from './reconciliationEvidence.js';
import {
  parseReconciliationResponse,
  validateReconciliation,
  type CanonicalReconciliation,
  type SourceEvent,
} from './reconciliation.js';

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

export type LexicalInventoryResult =
  | { complete: true; inventory: LexicalInventory }
  | { complete: false; reason: 'invalid-framing' | 'incomplete-token' | 'invalid-content' | 'bounds' };

function scanFailure(reason: Extract<LexicalInventoryResult, { complete: false }>['reason']): LexicalInventoryResult {
  return { complete: false, reason };
}

function framedJson(input: string): string | undefined {
  let value = input;
  const prefix = '⚠️  Reached maximum iterations (';
  if (value.startsWith(prefix)) {
    const suffix = '). Requesting summary...';
    const close = value.indexOf(suffix, prefix.length);
    if (close < 0 || !/^\d+$/u.test(value.slice(prefix.length, close))) return undefined;
    const contentStart = close + suffix.length;
    if (value.startsWith('\r\n', contentStart)) value = value.slice(contentStart + 2);
    else if (value.startsWith('\n', contentStart)) value = value.slice(contentStart + 1);
    else return undefined;
  }
  if (value.startsWith('```json')) {
    if (!(value.startsWith('```json\n') || value.startsWith('```json\r\n')) || !value.endsWith('```')) return undefined;
    value = value.slice(value.startsWith('```json\r\n') ? 9 : 8, -3);
  }
  return value;
}

function isDelimiter(value: string | undefined): boolean {
  return value === undefined || value === ',' || value === ':' || value === '[' || value === ']' || value === '{' || value === '}' || isJsonWhitespace(value);
}

function isJsonWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r';
}

function scanNumber(input: string, start: number): { end: number; value: string } | LexicalInventoryResult {
  let index = start;
  if (input[index] === '-') index += 1;
  if (index >= input.length) return scanFailure('incomplete-token');
  if (input[index] === '0') index += 1;
  else if (input[index]! >= '1' && input[index]! <= '9') {
    while (index < input.length && input[index]! >= '0' && input[index]! <= '9') index += 1;
  } else return scanFailure('incomplete-token');
  if (input[index] === '.') {
    index += 1;
    const fractionStart = index;
    while (index < input.length && input[index]! >= '0' && input[index]! <= '9') index += 1;
    if (index === fractionStart) return scanFailure('incomplete-token');
  }
  if (input[index] === 'e' || input[index] === 'E') {
    index += 1;
    if (input[index] === '+' || input[index] === '-') index += 1;
    const exponentStart = index;
    while (index < input.length && input[index]! >= '0' && input[index]! <= '9') index += 1;
    if (index === exponentStart) return scanFailure('incomplete-token');
  }
  const next = input[index];
  if (!isDelimiter(next)) return scanFailure('invalid-content');
  return { end: index, value: input.slice(start, index) };
}

type ScanFrame =
  | { kind: 'object'; state: 'key-or-end' | 'key-required' | 'colon' | 'value' | 'after-value' }
  | { kind: 'array'; state: 'value-or-end' | 'value-required' | 'after-value' };

function frameCanEnd(frame: ScanFrame): boolean {
  return frame.kind === 'object'
    ? frame.state === 'key-or-end' || frame.state === 'after-value'
    : frame.state === 'value-or-end' || frame.state === 'after-value';
}

function consumeValue(frame: ScanFrame): boolean {
  if (frame.kind === 'object') {
    if (frame.state !== 'value') return false;
    frame.state = 'after-value';
    return true;
  }
  if (frame.state !== 'value-or-end' && frame.state !== 'value-required' && frame.state !== 'after-value') return false;
  frame.state = 'after-value';
  return true;
}

function consumeString(frame: ScanFrame): boolean {
  if (frame.kind === 'object') {
    if (frame.state === 'key-or-end' || frame.state === 'key-required' || frame.state === 'after-value') {
      frame.state = 'colon';
      return true;
    }
    return consumeValue(frame);
  }
  return consumeValue(frame);
}

export function inventoryInvalidJson(input: string): LexicalInventoryResult {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_REPAIR_OUTPUT_BYTES) return scanFailure('bounds');
  const source = framedJson(input);
  if (source === undefined) return scanFailure('invalid-framing');
  const tokens: LexicalToken[] = [];
  const stack: ScanFrame[] = [];
  let rootStarted = false;
  let rootClosed = false;
  let index = 0;
  const add = (token: LexicalToken): LexicalInventoryResult | undefined => {
    if (tokens.length >= MAX_REPAIR_LEXICAL_TOKENS) return scanFailure('bounds');
    if ('value' in token && typeof token.value === 'string' && token.value.length > MAX_REPAIR_LEXICAL_TOKEN_CHARS) return scanFailure('bounds');
    tokens.push(token);
    return undefined;
  };
  while (index < source.length) {
    const char = source[index]!;
    if (isJsonWhitespace(char)) { index += 1; continue; }
    if (!rootStarted) {
      if (char !== '{') return scanFailure('invalid-content');
      rootStarted = true;
      stack.push({ kind: 'object', state: 'key-or-end' });
      index += 1;
      continue;
    }
    if (rootClosed || stack.length === 0) return scanFailure('invalid-content');
    const frame = stack[stack.length - 1]!;
    if (char === ',') {
      if (frame.kind === 'object' && frame.state === 'after-value') frame.state = 'key-required';
      else if (frame.kind === 'array' && frame.state === 'after-value') frame.state = 'value-required';
      else return scanFailure('invalid-content');
      index += 1;
      continue;
    }
    if (char === ':') {
      if (frame.kind !== 'object' || frame.state !== 'colon') return scanFailure('invalid-content');
      frame.state = 'value';
      index += 1;
      continue;
    }
    if (char === '{' || char === '[') {
      if (!consumeValue(frame)) return scanFailure('invalid-content');
      if (stack.length >= MAX_REPAIR_PATH_DEPTH) return scanFailure('bounds');
      stack.push(char === '{' ? { kind: 'object', state: 'key-or-end' } : { kind: 'array', state: 'value-or-end' });
      index += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      const expected = char === '}' ? 'object' : 'array';
      if (frame.kind !== expected || !frameCanEnd(frame)) return scanFailure('invalid-content');
      stack.pop();
      if (stack.length === 0) rootClosed = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      if (!consumeString(frame)) return scanFailure('invalid-content');
      let end = index + 1;
      let escaped = false;
      while (end < source.length) {
        const current = source[end]!;
        if (escaped) { escaped = false; end += 1; continue; }
        if (current.charCodeAt(0) === 92) { escaped = true; end += 1; continue; }
        if (current === '"') break;
        if (current.charCodeAt(0) < 0x20) return scanFailure('incomplete-token');
        end += 1;
      }
      if (end >= source.length || source[end] !== '"') return scanFailure('incomplete-token');
      let value: unknown;
      try { value = JSON.parse(source.slice(index, end + 1)); } catch { return scanFailure('incomplete-token'); }
      const failure = add({ kind: 'string', value: value as string });
      if (failure) return failure;
      index = end + 1;
      continue;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      if (!consumeValue(frame)) return scanFailure('invalid-content');
      const result = scanNumber(source, index);
      if ('complete' in result) return result;
      const failure = add({ kind: 'number', value: result.value });
      if (failure) return failure;
      index = result.end;
      continue;
    }
    if (source.startsWith('true', index) || source.startsWith('false', index)) {
      if (!consumeValue(frame)) return scanFailure('invalid-content');
      const value = source.startsWith('true', index);
      const end = index + (value ? 4 : 5);
      if (!isDelimiter(source[end])) return scanFailure('invalid-content');
      const failure = add({ kind: 'boolean', value });
      if (failure) return failure;
      index = end;
      continue;
    }
    if (source.startsWith('null', index)) {
      if (!consumeValue(frame)) return scanFailure('invalid-content');
      const end = index + 4;
      if (!isDelimiter(source[end])) return scanFailure('invalid-content');
      const failure = add({ kind: 'null' });
      if (failure) return failure;
      index = end;
      continue;
    }
    return scanFailure('invalid-content');
  }
  if (!rootStarted || tokens.length === 0 || stack.some((frame) => !frameCanEnd(frame))) {
    return scanFailure('incomplete-token');
  }
  return { complete: true, inventory: LexicalInventorySchema.parse({ tokens }) };
}

export function verifyLexicalPreservation(before: LexicalInventory, repaired: unknown): void {
  const beforeParsed = LexicalInventorySchema.safeParse(before);
  if (!beforeParsed.success) throw new RangeError('invalid lexical inventory');
  if (!isBoundedJson(repaired)) throw new RangeError('repaired output is not plain finite JSON');
  let serialized: string;
  try { serialized = JSON.stringify(repaired); } catch { throw new RangeError('repaired output is not JSON'); }
  if (serialized === undefined) throw new RangeError('repaired output is not JSON');
  const after = inventoryInvalidJson(serialized);
  if (!after.complete || JSON.stringify(after.inventory.tokens) !== JSON.stringify(beforeParsed.data.tokens)) {
    throw new RangeError('repaired output changed ordered lexical tokens');
  }
}

const repairFailureCategorySchema = z.enum([
  'unknown-event', 'missing-accounting', 'identity-mismatch', 'timeout', 'empty-output', 'source-security',
]);
export type RepairFailureCategory = z.infer<typeof repairFailureCategorySchema>;

const RepairClassificationResultSchema = z.object({
  classification: RepairClassificationSchema,
  issues: z.array(RepairIssueSchema).max(MAX_REPAIR_ISSUES),
  protection: RepairProtectionSchema.optional(),
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
      if (Object.getOwnPropertySymbols(current.value).length > 0) return false;
      const descriptors = Object.getOwnPropertyDescriptors(current.value);
      if (Object.keys(descriptors).length !== current.value.length + 1) return false;
      for (let index = 0; index < current.value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !('value' in descriptor)) return false;
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
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
  let protection: z.infer<typeof RepairProtectionSchema> | undefined;
  if (input.failureCategory) {
    classification = input.failureCategory === 'identity-mismatch' ? 'unrepairable-identity' : input.failureCategory === 'source-security' ? 'unrepairable-security' : input.failureCategory === 'unknown-event' || input.failureCategory === 'missing-accounting' ? 'unrepairable-semantic' : 'unrepairable-incomplete';
  } else if (input.parseError !== undefined) {
    const inventory = inventoryInvalidJson(input.originalOutput);
    if (inventory.complete) {
      classification = 'repairable-format';
      protection = { kind: 'lexical', value: inventory.inventory, digest: stableHash(inventory.inventory) };
    }
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
  return RepairClassificationResultSchema.parse({ classification, issues, ...(protection ? { protection } : {}) });
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

export interface RepairInvocationResult { stdout: string }
export type InvokeFormatRepair = (input: {
  prompt: string;
  payload: RepairPayload;
  signal: AbortSignal;
}) => Promise<RepairInvocationResult | string>;

export interface RepairValidationInput {
  packet: ReconciliationEvidencePacket;
  authoritativeSourceEvents: readonly SourceEvent[];
}

export interface RepairEvaluation {
  outcome: 'valid' | 'accepted' | 'unrepairable' | 'rejected';
  classification: RepairClassification | 'valid';
  metrics: { calls: number; retries: number };
  candidate?: CanonicalReconciliation;
  validation?: CanonicalReconciliation;
  protection?: RepairProtection;
  reason?: string;
}

type RepairProtection = z.infer<typeof RepairProtectionSchema>;

const DEFAULT_REPAIR_TIMEOUT_MS = 30_000;
const MAX_REPAIR_TIMEOUT_MS = 120_000;
const REPAIR_INSTRUCTIONS = [
  'Perform lossless format repair only.',
  'Return exactly one strict JSON repair envelope and no prose, markdown, explanation, or framing.',
  'Envelope contract: {"repairable":true,"repairedOutput":<strict reconciliation.v1 object>} or {"repairable":false,"reason":"incomplete-original|semantic-change-required|identity-change-required|unsupported-repair"}.',
  'Strict reconciliation.v1 fields: root={schemaVersion,promptVersion,chunk,cacheIdentity,blocks,omissions,materialCorrections,suspicionFlags,reviewNotes,summarySafety}; chunk={id,start,end}; cacheIdentity={inputHash,contextHash,sourceHash?,alignmentHash?,neighborHash?,channelMapHash?,glossaryHash?,correctionRulesHash?,evidenceRevision?,providerIdentity?}; blocks[*]={id,start,end,kind,text,summarySafeText,channel?,physicalSpeaker?,characterCandidate?,characterConfidence,attributionBasis,sourceEventIds,reviewFlags}; omissions[*]={sourceEventId,text,start,end,reason}; materialCorrections[*]={sourceEventId,sourceForm,replacement,evidence}; summarySafety={status,errors}. No other keys.',
  'Closed values: block kind=dialogue|narration|unclear; characterConfidence=confirmed|probable|unknown; reviewFlags=ambiguous-speaker|unclear-words|possible-omission|attribution-uncertain|material-correction; suspicionFlags=high-omitted-ratio|large-compression|decoder-loop-range|expected-character-only|unsupported-proper-noun|unexplained-silence|reordered-source-events; omission reason=decoder-loop|duplicate|false-start|non-speech|unintelligible|outside-logical-window; summarySafety.status=valid|pending.',
  'Do not use tools, external context, repository context, memory, or credentials.',
  'Do not rewrite readable content, identities, timestamps, attribution, accounting, or semantics.',
].join(' ');

export const RepairValidationRuntimeSchema = z.object({
  packet: z.object({
    schemaVersion: z.literal('reconciliation.v1'),
    promptVersion: z.string().min(1).max(160),
    chunk: ChunkWindowSchema,
    cacheIdentity: CacheIdentitySchema,
  }).strict(),
  authoritativeSourceEvents: z.array(SourceEventSchema).max(MAX_REPAIR_LEXICAL_TOKENS),
}).strict();

function repairResult(outcome: RepairEvaluation['outcome'], classification: RepairEvaluation['classification'], reason?: string): RepairEvaluation {
  return { outcome, classification, metrics: { calls: 0, retries: 0 }, ...(reason === undefined ? {} : { reason }) };
}

function sameIdentity(candidate: ReturnType<typeof parseReconciliationResponse>, packet: ReconciliationEvidencePacket): boolean {
  return candidate.schemaVersion === packet.schemaVersion
    && candidate.promptVersion === packet.promptVersion
    && JSON.stringify(candidate.chunk) === JSON.stringify(packet.chunk)
    && JSON.stringify(candidate.cacheIdentity) === JSON.stringify(packet.cacheIdentity);
}

function parseEnvelope(value: RepairInvocationResult | string, maxOutputBytes: number): RepairEnvelope {
  const output = typeof value === 'string' ? value : value.stdout;
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > maxOutputBytes) throw new Error('bounded output violation');
  const parsed: unknown = JSON.parse(output);
  return RepairEnvelopeSchema.parse(parsed);
}

export async function evaluateFormatRepair(options: {
  originalOutput: string;
  validation: RepairValidationInput;
  invoke: InvokeFormatRepair;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<RepairEvaluation> {
  if (options === null || typeof options !== 'object'
    || typeof options.originalOutput !== 'string'
    || Buffer.byteLength(options.originalOutput, 'utf8') > MAX_REPAIR_OUTPUT_BYTES
    || typeof options.invoke !== 'function'
    || !RepairValidationRuntimeSchema.safeParse(options.validation).success) {
    return repairResult('rejected', 'unrepairable-security', 'invalid repair evaluation input');
  }
  const maxOutputBytes = options.maxOutputBytes ?? MAX_REPAIR_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REPAIR_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_REPAIR_TIMEOUT_MS
    || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || maxOutputBytes > MAX_REPAIR_OUTPUT_BYTES) {
    return repairResult('rejected', 'unrepairable-security', 'invalid repair bounds');
  }

  let parsedOriginal: unknown;
  let classification: RepairClassificationResult;
  try {
    parsedOriginal = JSON.parse(options.originalOutput);
    const schema = ReconciliationResponseSchema.safeParse(parsedOriginal);
    if (schema.success) {
      if (!sameIdentity(schema.data, options.validation.packet)) return repairResult('rejected', 'unrepairable-identity', 'original identity mismatch');
      try {
        const validated = validateReconciliation(schema.data, { authoritativeSourceEvents: options.validation.authoritativeSourceEvents });
        return { outcome: 'valid', classification: 'valid', metrics: { calls: 0, retries: 0 }, validation: validated, candidate: validated };
      } catch {
        return repairResult('unrepairable', 'unrepairable-semantic', 'authoritative validation failed');
      }
    }
    classification = classifyRepairFailure({ originalOutput: options.originalOutput, parsedValue: parsedOriginal, zodIssues: schema.error.issues });
  } catch (error) {
    classification = classifyRepairFailure({ originalOutput: options.originalOutput, parseError: error });
  }
  if (classification.classification !== 'repairable-format') {
    return repairResult('unrepairable', classification.classification, 'format repair is not eligible');
  }
  const protection = classification.protection ?? (() => {
    try {
      const projection = buildProtectedProjection(parsedOriginal);
      return { kind: 'projection' as const, value: projection, digest: protectedDigest(projection) };
    } catch {
      return undefined;
    }
  })();
  if (protection === undefined) return repairResult('unrepairable', classification.classification, 'protection could not be established');

  const payload = RepairPayloadSchema.parse({
    repairVersion: REPAIR_VERSION,
    targetSchemaVersion: options.validation.packet.schemaVersion,
    originalOutput: options.originalOutput,
    classification: classification.classification,
    issues: classification.issues,
    protection,
  });
  assertRepairPayloadBytes(payload);
  const prompt = `${REPAIR_PROMPT_VERSION}\n${REPAIR_INSTRUCTIONS}\n${JSON.stringify(payload)}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      options.invoke({ prompt, payload, signal: controller.signal }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('repair timeout')); }, timeoutMs); }),
    ]);
    const envelope = parseEnvelope(result, maxOutputBytes);
    if (!envelope.repairable) return { ...repairResult('unrepairable', classification.classification, envelope.reason), metrics: { calls: 1, retries: 0 }, protection };
    const repaired = parseReconciliationResponse(envelope.repairedOutput);
    if (!sameIdentity(repaired, options.validation.packet)) throw new Error('repaired identity mismatch');
    if (protection.kind === 'projection') {
      if (protectedDigest(buildProtectedProjection(repaired)) !== protection.digest) throw new Error('protected projection mismatch');
    } else {
      verifyLexicalPreservation(protection.value, repaired);
    }
    const validated = validateReconciliation(repaired, { authoritativeSourceEvents: options.validation.authoritativeSourceEvents });
    const candidate = structuredClone(validated);
    candidate.status = 'needs_review';
    return { outcome: 'accepted', classification: classification.classification, metrics: { calls: 2, retries: 1 }, candidate, validation: validated, protection };
  } catch {
    controller.abort();
    return { outcome: 'rejected', classification: classification.classification, metrics: { calls: 1, retries: 0 }, protection, reason: 'repair invocation or validation failed' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
