import { z } from "zod";
import type { ChannelMap } from "./channelMap.js";
import type { TranscriptSegment } from "./types.js";

const DUPLICATE_SIMILARITY = 0.78;
const MIN_OVERLAP_RATIO = 0.35;
const MIN_ENERGY_MARGIN = 0.2;

const finiteTime = z.number().finite().nonnegative();
const optionalConfidence = z.number().finite().min(0).max(1).optional();
const alignmentAlternativeSchema = z.object({
  text: z.string().trim().min(1), sourcePass: z.string().trim().min(1),
  channel: z.string().trim().min(1).optional(), confidence: optionalConfidence,
  relativeEnergy: z.number().finite().nonnegative().optional(),
  globalStart: finiteTime, globalEnd: finiteTime,
}).strict().superRefine((value, ctx) => {
  if (value.globalEnd < value.globalStart) ctx.addIssue({ code: "custom", message: "end must not precede start", path: ["globalEnd"] });
});
export const AlignmentEventSchema = z.object({
  text: z.string().trim().min(1), sourcePass: z.string().trim().min(1),
  globalStart: finiteTime, globalEnd: finiteTime, confidence: optionalConfidence,
  channel: z.string().trim().min(1).optional(), physicalSpeaker: z.string().trim().min(1).optional(), character: z.never().optional(),
  alternatives: z.array(alignmentAlternativeSchema),
}).strict().superRefine((value, ctx) => {
  if (value.globalEnd < value.globalStart) ctx.addIssue({ code: "custom", message: "end must not precede start", path: ["globalEnd"] });
});
export const AlignmentResultSchema = z.object({ version: z.literal(1), events: z.array(AlignmentEventSchema) }).strict();
export type AlignmentAlternative = z.infer<typeof alignmentAlternativeSchema>;
export type AlignmentEvent = z.infer<typeof AlignmentEventSchema>;
export type AlignmentResult = z.infer<typeof AlignmentResultSchema>;
export function parseAlignmentResult(value: unknown): AlignmentResult { return AlignmentResultSchema.parse(value); }

export function isAlignmentArtifactName(name: string): boolean {
  return /^session_\d+\.json$/.test(name);
}

export interface AlignmentChannelInput {
  passId: string; channelId: string; segments: TranscriptSegment[];
  segmentEnergies: Array<number | undefined>;
}
export interface AlignmentInput {
  chunkStart: number; stereo: TranscriptSegment[]; channels: AlignmentChannelInput[];
  channelMap?: Record<string, { speaker: string; expectedCharacters?: string[] }> | ChannelMap;
  logicalStart?: number; logicalEnd?: number;
}

function normalize(text: string): string { return text.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function similarity(left: string, right: string): number {
  const a = normalize(left), b = normalize(right); if (!a || !b) return 0; if (a === b) return 1;
  const aw = new Set(a.split(" ")), bw = new Set(b.split(" ")); return (2 * [...aw].filter((word) => bw.has(word)).length) / (aw.size + bw.size);
}
function overlapRatio(a: TranscriptSegment, b: TranscriptSegment): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.min(a.end - a.start, b.end - b.start); return shorter <= 0 ? 0 : overlap / shorter;
}
function speakerMap(channelMap: AlignmentInput["channelMap"]): Map<string, string> {
  if (!channelMap) return new Map();
  if ("channels" in channelMap && Array.isArray(channelMap.channels)) {
    return new Map(channelMap.channels.filter((channel) => channel.speakers.length === 1).map((channel) => [channel.id, channel.speakers[0]!.name]));
  }
  return new Map(Object.entries(channelMap).map(([id, value]) => [id, value.speaker]));
}
function inLogicalWindow(segment: TranscriptSegment, input: AlignmentInput): boolean {
  if (input.logicalStart === undefined || input.logicalEnd === undefined) return true;
  const midpoint = input.chunkStart + (segment.start + segment.end) / 2;
  return midpoint >= input.logicalStart && midpoint < input.logicalEnd;
}
function alternativeFor(segment: TranscriptSegment, sourcePass: string, channel: string | undefined, energy: number | undefined, chunkStart: number): AlignmentAlternative {
  return { text: segment.text.trim(), sourcePass, channel, confidence: segment.confidence, relativeEnergy: energy, globalStart: chunkStart + segment.start, globalEnd: chunkStart + segment.end };
}

export function alignHybridChunk(input: AlignmentInput): AlignmentResult {
  const speakers = speakerMap(input.channelMap);

  const candidates: Array<{ segment: TranscriptSegment; sourcePass: string; channel?: string; relativeEnergy?: number }> = [
    ...input.stereo.filter((segment) => inLogicalWindow(segment, input)).map((segment) => ({ segment, sourcePass: "stereo" })),
    ...input.channels.flatMap((channel) => channel.segments.flatMap((segment, index) =>
      inLogicalWindow(segment, input)
        ? [{ segment, sourcePass: channel.passId, channel: channel.channelId, relativeEnergy: channel.segmentEnergies[index] }]
        : [])),
  ];
  const events: AlignmentEvent[] = [];
  for (const candidate of candidates) {
    if (!candidate.segment.text.trim()) continue;
    const existing = events.find((event) => {
      const local = { start: event.globalStart - input.chunkStart, end: event.globalEnd - input.chunkStart, text: event.text };
      return overlapRatio(candidate.segment, local) >= MIN_OVERLAP_RATIO && similarity(candidate.segment.text, event.text) >= DUPLICATE_SIMILARITY;
    });
    const alternative = alternativeFor(candidate.segment, candidate.sourcePass, candidate.channel, candidate.relativeEnergy, input.chunkStart);
    if (existing) {
      if (candidate.sourcePass === "stereo") {
        Object.assign(existing, { text: candidate.segment.text.trim(), sourcePass: "stereo", confidence: candidate.segment.confidence, globalStart: alternative.globalStart, globalEnd: alternative.globalEnd });
      } else if (candidate.sourcePass !== existing.sourcePass && !existing.alternatives.some((item) => item.sourcePass === candidate.sourcePass && item.text === alternative.text)) existing.alternatives.push(alternative);
      continue;
    }
    events.push({ text: candidate.segment.text.trim(), sourcePass: candidate.sourcePass, globalStart: alternative.globalStart, globalEnd: alternative.globalEnd, confidence: candidate.segment.confidence, channel: candidate.channel, alternatives: candidate.sourcePass === "stereo" ? [] : [alternative] });
  }
  for (const event of events) {
    const evidence = [
      ...event.alternatives.filter((alternative) => alternative.channel).map((alternative) => ({ channel: alternative.channel!, relativeEnergy: alternative.relativeEnergy })),
    ].filter((item): item is { channel: string; relativeEnergy: number } => item.relativeEnergy !== undefined && Number.isFinite(item.relativeEnergy) && item.relativeEnergy >= 0);
    const ranked = [...new Map(evidence.map((item) => [item.channel, item])).values()].sort((a, b) => b.relativeEnergy - a.relativeEnergy);
    if (ranked.length >= 2 && ranked[0]!.relativeEnergy - ranked[1]!.relativeEnergy >= MIN_ENERGY_MARGIN) {
      event.channel = ranked[0]!.channel;
      const speaker = speakers.get(event.channel); if (speaker) event.physicalSpeaker = speaker;
    }
    event.alternatives.sort((a, b) => Number(a.text === event.text) - Number(b.text === event.text) || (b.relativeEnergy ?? -Infinity) - (a.relativeEnergy ?? -Infinity));
  }
  events.sort((a, b) => a.globalStart - b.globalStart || (a.sourcePass === "stereo" ? -1 : b.sourcePass === "stereo" ? 1 : 0) || a.globalEnd - b.globalEnd || a.sourcePass.localeCompare(b.sourcePass));
  return parseAlignmentResult({ version: 1, events });
}

export function buildHybridCorrectionContext(results: AlignmentResult[], channelMap: ChannelMap): { channelEvidence: string; channelMapContext: string } {
  const channelMapContext = channelMap.channels.map((channel) => `${channel.id}: ${channel.speakers.map((speaker) => speaker.name).join(", ") || "unassigned"}; expected: ${channel.speakers.flatMap((speaker) => speaker.expectedCharacters.map((character) => character.name)).join(", ") || "none"}`).join("\n");
  const channelEvidence = results.flatMap((result) => result.events).flatMap((event) => {
    const labels = [`[${formatTimestamp(event.globalStart)} - ${formatTimestamp(event.globalEnd)}]`];
    if (event.channel) labels.push(`[channel:${event.channel}]`); if (event.physicalSpeaker) labels.push(`[speaker:${event.physicalSpeaker}]`);
    const alternatives = event.alternatives.map((alternative) => {
      const fields = [`source:${alternative.sourcePass}`];
      if (alternative.channel) fields.push(`channel:${alternative.channel}`);
      if (alternative.confidence !== undefined) fields.push(`confidence:${alternative.confidence}`);
      if (alternative.relativeEnergy !== undefined) fields.push(`relative-energy:${alternative.relativeEnergy}`);
      return `  alternative [${formatTimestamp(alternative.globalStart)} - ${formatTimestamp(alternative.globalEnd)}] [${fields.join("] [")}] ${alternative.text}`;
    });
    return [`${labels.join(" ")} [source:${event.sourcePass}] ${event.text}`, ...alternatives];
  }).join("\n");
  return { channelEvidence, channelMapContext };
}

export function alignmentMarkdown(result: AlignmentResult): string {
  return result.events.map((event) => {
    const labels = [`[${formatTimestamp(event.globalStart)} - ${formatTimestamp(event.globalEnd)}]`];
    if (event.channel) labels.push(`[channel:${event.channel}]`); if (event.physicalSpeaker) labels.push(`[speaker:${event.physicalSpeaker}]`);
    return `${labels.join(" ")} ${event.text}`;
  }).join("\n") + (result.events.length ? "\n" : "");
}
function formatTimestamp(seconds: number): string { const total = Math.floor(seconds); return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map((part) => String(part).padStart(2, "0")).join(":"); }
