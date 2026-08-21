import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AlignmentEventSchema,
  AlignmentResultSchema,
  type AlignmentEvent,
  type AlignmentResult,
} from "./alignment.js";
import { channelMapSchema, type ChannelMap } from "./channelMap.js";
import type { SourceEvent } from "./reconciliation.js";

export const RECONCILIATION_EVIDENCE_VERSION = 1 as const;
export const RECONCILIATION_PROMPT_VERSION = "reconciliation.prompt.v2" as const;

export type ProviderIdentity = { provider: string; model: string; profile?: string };
export type ContextOnly = {
  contextOnly: true;
  previousReadableTail: readonly string[];
  nextAlignmentHead: readonly AlignmentEvent[];
};
export interface ReconciliationEvidenceInput {
  sourceHash: string;
  alignment: AlignmentResult;
  logicalStart: number;
  logicalEnd: number;
  chunkIndex: number;
  previousReadableTail?: readonly string[];
  nextAlignmentHead?: readonly AlignmentEvent[];
  neighborLimit?: number;
  channelMap?: ChannelMap;
  glossary?: readonly string[];
  correctionRules?: readonly string[];
  expectedCharacters?: readonly string[];
  campaign?: string;
  sessionDate?: string;
  provider: ProviderIdentity;
  promptVersion?: string;
  schemaVersion?: string;
  evidenceRevision: string;
}
export type EvidenceSourceEvent = SourceEvent &
  Pick<AlignmentEvent, "sourcePass" | "channel" | "physicalSpeaker" | "alternatives">;
export interface ReconciliationEvidencePacket {
  evidenceVersion: 1;
  promptVersion: string;
  schemaVersion: string;
  chunk: { id: string; start: number; end: number };
  ownedEvents: EvidenceSourceEvent[];
  context: ContextOnly;
  channelMap?: ChannelMap;
  expectedCharacters: string[];
  glossary: string[];
  correctionRules: string[];
  campaign?: string;
  sessionDate?: string;
  provider: ProviderIdentity;
  evidenceRevision: string;
  cacheIdentity: CacheIdentity;
}
export type CacheIdentity = {
  inputHash: string;
  contextHash: string;
  sourceHash: string;
  alignmentHash: string;
  neighborHash: string;
  channelMapHash: string;
  glossaryHash: string;
  correctionRulesHash: string;
  evidenceRevision: string;
  providerIdentity: string;
};

const boundedString = z.string().trim().min(1).max(2_000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const evidenceInputSchema = z
  .object({
    sourceHash: sha256,
    alignment: AlignmentResultSchema,
    logicalStart: z.number().finite().nonnegative(),
    logicalEnd: z.number().finite().nonnegative(),
    chunkIndex: z.number().int().nonnegative().max(1_000_000),
    previousReadableTail: z.array(z.string().max(20_000)).max(64).optional(),
    nextAlignmentHead: z.array(AlignmentEventSchema).max(64).optional(),
    neighborLimit: z.number().int().nonnegative().max(64).optional(),
    channelMap: channelMapSchema.optional(),
    glossary: z.array(boundedString).max(20_000).optional(),
    correctionRules: z.array(boundedString).max(20_000).optional(),
    expectedCharacters: z.array(boundedString).max(1_000).optional(),
    campaign: boundedString.optional(),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
    provider: z
      .object({
        provider: boundedString,
        model: boundedString,
        profile: boundedString.optional(),
      })
      .strict(),
    promptVersion: boundedString.optional(),
    schemaVersion: boundedString.optional(),
    evidenceRevision: boundedString,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.logicalEnd <= value.logicalStart) {
      context.addIssue({
        code: "custom",
        message: "logicalEnd must be greater than logicalStart",
        path: ["logicalEnd"],
      });
    }
  });

function parseEvidenceInput(value: unknown): ReconciliationEvidenceInput {
  return evidenceInputSchema.parse(value);
}

function canonical(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Cannot hash a cyclic value");
    seen.add(value);
    try {
      return value.map((item) => canonical(item, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Cannot hash a non-plain object");
    }
    if (seen.has(value)) throw new TypeError("Cannot hash a cyclic value");
    seen.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, canonical(item, seen)]),
      );
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Cannot hash a non-finite number");
  }
  if (["bigint", "function", "symbol"].includes(typeof value)) {
    throw new TypeError("Cannot hash an unsupported value");
  }
  return value;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function assignStableEventId(chunkIndex: number, ordinal: number): string {
  const parsedChunkIndex = z.number().int().nonnegative().max(1_000_000).parse(chunkIndex);
  const parsedOrdinal = z.number().int().nonnegative().max(1_000_000).parse(ordinal);
  return `session_${String(parsedChunkIndex).padStart(3, "0")}:event_${String(parsedOrdinal).padStart(4, "0")}`;
}

function eventTieKey(event: AlignmentEvent): string {
  const alternatives = event.alternatives.map((alternative) => stableHash(alternative)).sort();
  return stableHash({ ...event, alternatives });
}

function ordered(alignment: AlignmentResult): Array<{ event: AlignmentEvent; ordinal: number; tieKey: string }> {
  const entries = alignment.events
    .map((event, ordinal) => ({ event, ordinal, tieKey: eventTieKey(event) }));
  if (new Set(entries.map((entry) => entry.tieKey)).size !== entries.length) {
    throw new Error("duplicate alignment event lacks a stable source identity");
  }
  return entries
    .sort(
      (left, right) =>
        left.event.globalStart - right.event.globalStart ||
        left.event.globalEnd - right.event.globalEnd ||
        left.event.sourcePass.localeCompare(right.event.sourcePass) ||
        left.tieKey.localeCompare(right.tieKey) ||
        left.ordinal - right.ordinal,
    );
}

export function selectOwnedAlignmentEvents(
  alignment: AlignmentResult,
  chunkIndex: number,
  logicalStart: number,
  logicalEnd: number,
): EvidenceSourceEvent[] {
  const parsedAlignment = AlignmentResultSchema.parse(alignment);
  const parsedChunkIndex = z.number().int().nonnegative().max(1_000_000).parse(chunkIndex);
  const parsedStart = z.number().finite().nonnegative().parse(logicalStart);
  const parsedEnd = z.number().finite().nonnegative().parse(logicalEnd);
  if (parsedEnd <= parsedStart) {
    throw new RangeError("logicalEnd must be greater than logicalStart");
  }

  return ordered(parsedAlignment).flatMap(({ event }, ordinal) => {
    const midpoint = (event.globalStart + event.globalEnd) / 2;
    if (!(midpoint >= parsedStart && midpoint < parsedEnd)) return [];
    const crossing = event.globalStart < parsedStart || event.globalEnd > parsedEnd;
    return [
      {
        id: assignStableEventId(parsedChunkIndex, ordinal),
        text: event.text,
        start: event.globalStart,
        end: event.globalEnd,
        ...(event.confidence === undefined ? {} : { confidence: event.confidence }),
        ...(crossing
          ? {
              supportedRange: {
                start: Math.max(event.globalStart, parsedStart),
                end: Math.min(event.globalEnd, parsedEnd),
              },
            }
          : {}),
        sourcePass: event.sourcePass,
        channel: event.channel,
        physicalSpeaker: event.physicalSpeaker,
        alternatives: event.alternatives,
      },
    ];
  });
}

function normalizeOwned(input: ReconciliationEvidenceInput): EvidenceSourceEvent[] {
  return selectOwnedAlignmentEvents(
    input.alignment,
    input.chunkIndex,
    input.logicalStart,
    input.logicalEnd,
  );
}

function channelExpected(channelMap: ChannelMap | undefined): string[] {
  if (!channelMap) return [];
  return channelMap.channels.flatMap((channel) =>
    channel.speakers.flatMap((speaker) =>
      speaker.expectedCharacters.map((character) => character.name),
    ),
  );
}

function bounded<T>(values: readonly T[] | undefined, limit: number): T[] {
  if (limit === 0) return [];
  return [...(values ?? [])].slice(-limit);
}

function head<T>(values: readonly T[] | undefined, limit: number): T[] {
  return [...(values ?? [])].slice(0, limit);
}

function identityParts(input: ReconciliationEvidenceInput) {
  const owned = normalizeOwned(input);
  const neighbors = {
    previousReadableTail: bounded(input.previousReadableTail, input.neighborLimit ?? 8),
    nextAlignmentHead: head(input.nextAlignmentHead, input.neighborLimit ?? 8),
  };
  const provider = {
    provider: input.provider.provider,
    model: input.provider.model,
    profile: input.provider.profile,
  };
  return {
    source: { sourceHash: input.sourceHash, alignment: input.alignment, owned },
    neighbors,
    provider,
    window: {
      id: `session_${String(input.chunkIndex).padStart(3, "0")}`,
      start: input.logicalStart,
      end: input.logicalEnd,
    },
    channelMap: input.channelMap,
    glossary: [...(input.glossary ?? [])],
    correctionRules: [...(input.correctionRules ?? [])],
    expectedCharacters: [...(input.expectedCharacters ?? [])],
    campaign: input.campaign,
    sessionDate: input.sessionDate,
    promptVersion: input.promptVersion ?? RECONCILIATION_PROMPT_VERSION,
    schemaVersion: input.schemaVersion ?? "reconciliation.v1",
    evidenceRevision: input.evidenceRevision,
  };
}

export function buildReconciliationCacheIdentity(
  input: ReconciliationEvidenceInput,
): CacheIdentity {
  const parsed = parseEvidenceInput(input);
  const parts = identityParts(parsed);
  const sourceHash = parsed.sourceHash;
  const alignmentHash = stableHash(parsed.alignment);
  const neighborHash = stableHash(parts.neighbors);
  const channelMapHash = stableHash(parts.channelMap);
  const glossaryHash = stableHash(parts.glossary);
  const correctionRulesHash = stableHash(parts.correctionRules);
  const providerIdentity = JSON.stringify(canonical(parts.provider));
  const contextHash = stableHash({
    neighbors: parts.neighbors,
    channelMap: parts.channelMap,
    glossary: parts.glossary,
    correctionRules: parts.correctionRules,
    expectedCharacters: parts.expectedCharacters,
    campaign: parts.campaign,
    sessionDate: parts.sessionDate,
    evidenceRevision: parts.evidenceRevision,
  });
  return {
    inputHash: stableHash(parts),
    contextHash,
    sourceHash,
    alignmentHash,
    neighborHash,
    channelMapHash,
    glossaryHash,
    correctionRulesHash,
    evidenceRevision: parsed.evidenceRevision,
    providerIdentity,
  };
}

export function buildEvidencePacket(
  input: ReconciliationEvidenceInput,
): ReconciliationEvidencePacket {
  const parsed = parseEvidenceInput(input);
  const ownedEvents = normalizeOwned(parsed);
  const limit = parsed.neighborLimit ?? 8;
  const packet = {
    evidenceVersion: RECONCILIATION_EVIDENCE_VERSION,
    promptVersion: parsed.promptVersion ?? RECONCILIATION_PROMPT_VERSION,
    schemaVersion: parsed.schemaVersion ?? "reconciliation.v1",
    chunk: {
      id: `session_${String(parsed.chunkIndex).padStart(3, "0")}`,
      start: parsed.logicalStart,
      end: parsed.logicalEnd,
    },
    ownedEvents,
    context: {
      contextOnly: true as const,
      previousReadableTail: bounded(parsed.previousReadableTail, limit),
      nextAlignmentHead: head(parsed.nextAlignmentHead, limit),
    },
    channelMap: parsed.channelMap,
    expectedCharacters: [
      ...new Set([
        ...(parsed.expectedCharacters ?? []),
        ...channelExpected(parsed.channelMap),
      ]),
    ],
    glossary: [...(parsed.glossary ?? [])],
    correctionRules: [...(parsed.correctionRules ?? [])],
    campaign: parsed.campaign,
    sessionDate: parsed.sessionDate,
    provider: { ...parsed.provider },
    evidenceRevision: parsed.evidenceRevision,
  };
  return {
    ...packet,
    cacheIdentity: buildReconciliationCacheIdentity(parsed),
  } as ReconciliationEvidencePacket;
}
