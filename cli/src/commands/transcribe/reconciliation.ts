import { z } from "zod";

const finite = z.number().finite();
const nonEmpty = z.string().trim().min(1);
const bounded = nonEmpty.max(160);
const identifier = bounded;
const identityValue = nonEmpty.max(4_096);
const content = z.string().max(20_000);
const nonEmptyContent = z.string().trim().min(1).max(20_000);
const MAX_EVENTS_PER_CHUNK = 2_048;
const TimeRangeSchema = z.object({ start: finite, end: finite }).strict();

export const SourceEventSchema = z.object({
  id: identifier,
  text: nonEmptyContent,
  start: finite,
  end: finite,
  confidence: finite.optional(),
  supportedRange: TimeRangeSchema.optional(),
}).strict().superRefine((event, context) => {
  if (event.end < event.start) {
    context.addIssue({ code: "custom", message: "source event end must not precede start", path: ["end"] });
  }
  if (event.supportedRange && (
    event.supportedRange.end <= event.supportedRange.start
    || event.supportedRange.start < event.start
    || event.supportedRange.end > event.end
  )) {
    context.addIssue({ code: "custom", message: "supported range must be a nonempty subset of the source range", path: ["supportedRange"] });
  }
});

export const CacheIdentitySchema = z.object({
  inputHash: identityValue, contextHash: identityValue, sourceHash: identityValue.optional(), alignmentHash: identityValue.optional(),
  neighborHash: identityValue.optional(), channelMapHash: identityValue.optional(), glossaryHash: identityValue.optional(),
  correctionRulesHash: identityValue.optional(), evidenceRevision: identityValue.optional(), providerIdentity: identityValue.optional(),
}).strict();

export const ChunkWindowSchema = z.object({ id: identifier, start: finite, end: finite }).strict();

const confidence = z.enum(["confirmed", "probable", "unknown"]);
const suspicionFlag = z.enum([
  "high-omitted-ratio", "large-compression", "decoder-loop-range", "expected-character-only",
  "unsupported-proper-noun", "unexplained-silence", "reordered-source-events",
]);
const reviewFlag = z.enum(["ambiguous-speaker", "unclear-words", "possible-omission", "attribution-uncertain", "material-correction"]);

export const ReconciliationBlockSchema = z.object({
  id: identifier,
  start: finite,
  end: finite,
  kind: z.enum(["dialogue", "narration", "unclear"]),
  text: nonEmptyContent,
  summarySafeText: content,
  channel: identifier.optional(),
  physicalSpeaker: identifier.optional(),
  characterCandidate: identifier.optional(),
  characterConfidence: confidence,
  attributionBasis: z.array(bounded).min(1).max(8),
  sourceEventIds: z.array(identifier).min(1).max(MAX_EVENTS_PER_CHUNK),
  reviewFlags: z.array(reviewFlag).max(8),
}).strict();

export const OmissionSchema = z.object({
  sourceEventId: identifier, text: content, start: finite, end: finite,
  reason: z.enum(["decoder-loop", "duplicate", "false-start", "non-speech", "unintelligible", "outside-logical-window"]),
}).strict();

export const MaterialCorrectionSchema = z.object({
  sourceEventId: identifier, sourceForm: nonEmptyContent, replacement: nonEmptyContent, evidence: z.array(bounded).min(1).max(8),
}).strict();

export const SummarySafetySchema = z.object({ status: z.enum(["valid", "pending"]), errors: z.array(bounded).max(8) }).strict();

/** Model output deliberately contains no source-event universe or joined text tiers. */
export const ReconciliationResponseSchema = z.object({
  schemaVersion: z.literal("reconciliation.v1"), promptVersion: identifier,
  chunk: ChunkWindowSchema, cacheIdentity: CacheIdentitySchema,
  blocks: z.array(ReconciliationBlockSchema).min(1).max(MAX_EVENTS_PER_CHUNK), omissions: z.array(OmissionSchema).max(MAX_EVENTS_PER_CHUNK),
  materialCorrections: z.array(MaterialCorrectionSchema).max(MAX_EVENTS_PER_CHUNK), suspicionFlags: z.array(suspicionFlag).max(8),
  reviewNotes: z.array(bounded).max(8), summarySafety: SummarySafetySchema,
}).strict();

export type SourceEvent = z.infer<typeof SourceEventSchema>;
export type ValidationContext = { authoritativeSourceEvents: readonly SourceEvent[] };
export type ReconciliationBlock = z.infer<typeof ReconciliationBlockSchema>;
export type ReconciliationResponse = z.infer<typeof ReconciliationResponseSchema>;
export type ReconciliationStatus = "valid" | "needs_review" | "invalid";
export type CanonicalReconciliation = ReconciliationResponse & { status: ReconciliationStatus };
export const CanonicalReconciliationSchema = ReconciliationResponseSchema.extend({ status: z.enum(["valid", "needs_review", "invalid"]) }).strict();

export function parseReconciliationResponse(value: unknown): ReconciliationResponse { return ReconciliationResponseSchema.parse(value); }
function invalid(message: string): never { throw new Error(`Invalid reconciliation: ${message}`); }
function hasText(value: string): boolean { return value.trim().length > 0; }

function withoutStatus(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "status" in value) {
    const { status: _status, ...response } = value as Record<string, unknown>;
    return response;
  }
  return value;
}

export function validateReconciliation(value: unknown, context: ValidationContext): CanonicalReconciliation {
  const response = parseReconciliationResponse(withoutStatus(value));
  const { chunk, blocks, omissions } = response;
  if (!(chunk.end > chunk.start)) invalid("invalid logical window");

  const authoritative = z.array(SourceEventSchema).max(MAX_EVENTS_PER_CHUNK).parse(
    context.authoritativeSourceEvents,
  );
  if (new Set(authoritative.map((event) => event.id)).size !== authoritative.length) invalid("duplicate authoritative source event id");
  const eventById = new Map(authoritative.map((event) => [event.id, event]));

  const ownership = new Map<string, string>();
  const blockIds = new Set<string>();
  for (const block of blocks) {
    if (blockIds.has(block.id)) invalid("duplicate block id");
    blockIds.add(block.id);
    if (!(block.end > block.start) || block.start < chunk.start || block.end > chunk.end) invalid("block outside logical window");
    if (block.characterConfidence === "unknown" && block.characterCandidate !== undefined) invalid("unknown attribution fabricates a candidate");
    if (block.characterConfidence !== "unknown" && block.characterCandidate === undefined) invalid("attribution lacks a candidate");
    const claimed = block.sourceEventIds.map((id) => eventById.get(id));
    if (claimed.some((event) => event === undefined)) invalid("block claims unknown event");
    const events = claimed as SourceEvent[];
    const supportedStart = Math.min(...events.map((event) => event.supportedRange?.start ?? event.start));
    const supportedEnd = Math.max(...events.map((event) => event.supportedRange?.end ?? event.end));
    if (block.start !== supportedStart || block.end !== supportedEnd) invalid("block has unsupported timestamps");
    for (const event of events) {
      if (ownership.has(event.id)) invalid("source event consumed more than once");
      const eventSupport = event.supportedRange ?? event;
      if (eventSupport.start < block.start || eventSupport.end > block.end) invalid("block does not support a claimed event");
      ownership.set(event.id, block.id);
    }
  }
  for (let index = 1; index < blocks.length; index += 1) {
    if (blocks[index]!.start < blocks[index - 1]!.start) invalid("non-overlap blocks are reordered");
  }

  for (const omission of omissions) {
    const event = eventById.get(omission.sourceEventId);
    if (!event) invalid("omission claims unknown event");
    if (ownership.has(omission.sourceEventId)) invalid("source event accounted twice");
    if (omission.text !== event.text || omission.start !== event.start || omission.end !== event.end) invalid("omission snapshot mismatch");
    ownership.set(omission.sourceEventId, `omission:${omission.sourceEventId}`);
  }
  if (ownership.size !== authoritative.length) invalid("source event is missing accounting");
  for (const correction of response.materialCorrections) {
    const sourceEvent = eventById.get(correction.sourceEventId);
    if (!sourceEvent) invalid("correction claims unknown event");
    if (!ownership.has(correction.sourceEventId)) invalid("correction source is unaccounted");
    if (correction.sourceForm !== sourceEvent.text) invalid("correction source form mismatch");
  }

  const flags = new Set(response.suspicionFlags);
  if (blocks.some((block) => block.attributionBasis.length === 1 && block.attributionBasis[0] === "expected-character-membership")) flags.add("expected-character-only");
  const hasBlockReview = blocks.some((block) => block.reviewFlags.length > 0);
  const summaryPending = response.summarySafety.status === "pending"
    || response.summarySafety.errors.length > 0
    || blocks.some((block) => !hasText(block.summarySafeText));
  const summarySafety = summaryPending
    ? { status: "pending" as const, errors: response.summarySafety.errors.length ? response.summarySafety.errors : ["summary-safe validation pending"] }
    : response.summarySafety;
  const status: ReconciliationStatus = flags.size > 0 || hasBlockReview ? "needs_review" : "valid";
  return { ...response, suspicionFlags: [...flags] as z.infer<typeof suspicionFlag>[], summarySafety, status };
}

export function parseCanonicalReconciliation(value: unknown, context: ValidationContext): CanonicalReconciliation {
  if (typeof value === "object" && value !== null && "status" in value) {
    const parsed = CanonicalReconciliationSchema.parse(value);
    if (parsed.status === "invalid") invalid("canonical artifact is marked invalid");
    return validateReconciliation(parsed, context);
  }
  return validateReconciliation(value, context);
}

export function deriveReconciliationStatus(value: ReconciliationResponse | CanonicalReconciliation, context: ValidationContext): CanonicalReconciliation {
  return parseCanonicalReconciliation(value, context);
}
