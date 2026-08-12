import { z } from "zod";

export interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
}

export type ChunkBoundaryReason =
  | "nearby-silence"
  | "widened-silence"
  | "exact-target"
  | "duration-end";

export interface PlannedChunk {
  index: number;
  start: number;
  end: number;
  overlapStart: number;
  overlapEnd: number;
  endReason: ChunkBoundaryReason;
}

export interface AudioProbeMetadata {
  durationSeconds: number;
  channels: number;
  channelLayout?: string;
  sampleRate: number;
}

export interface SourceFingerprint {
  sizeBytes: number;
  mtimeMs: number;
}

export interface ManifestChannel {
  id: string;
  index: number;
  path: string;
}

export interface AudioPreparationSettings {
  denoise: boolean;
  voiceBoost: boolean;
  sampleRate: number;
}

export interface ChunkSettings {
  chunkSeconds: number;
  boundarySearchSeconds: number;
  boundaryMaxSearchSeconds: number;
  overlapSeconds: number;
  keepSilence: boolean;
  silencePaddingSeconds: number;
  minimumSpeechSeconds: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
  avgLogprob?: number;
  compressionRatio?: number;
  noSpeechProb?: number;
  temperature?: number;
}

export interface ChunkTranscript {
  segments: TranscriptSegment[];
  language?: string;
  language_probability?: number;
  duration?: number;
}

const finiteNonNegative = z.number().finite().nonnegative();
const transcriptSegmentSchema = z.object({
  start: finiteNonNegative,
  end: finiteNonNegative,
  text: z.string(),
  confidence: z.number().finite().optional(),
  avgLogprob: z.number().finite().optional(),
  compressionRatio: z.number().finite().optional(),
  noSpeechProb: z.number().finite().optional(),
  temperature: z.number().finite().optional(),
}).strict().superRefine((segment, ctx) => {
  if (segment.end < segment.start) ctx.addIssue({ code: "custom", message: "segment end must not precede start", path: ["end"] });
});

export const ChunkTranscriptSchema = z.object({
  segments: z.array(transcriptSegmentSchema),
  language: z.string().optional(),
  language_probability: z.number().finite().nonnegative().optional(),
  duration: finiteNonNegative.optional(),
}).strict();

export function parseChunkTranscript(value: unknown): ChunkTranscript {
  return ChunkTranscriptSchema.parse(value);
}

export interface Manifest {
  version: 2;
  source: string;
  sourceFingerprint: SourceFingerprint;
  sourceProbe: AudioProbeMetadata;
  normalizedStereo: string;
  preparedChannels: ManifestChannel[];
  audioSettings: AudioPreparationSettings;
  chunkSettings: ChunkSettings;
  durationSeconds: number;
  silences?: SilenceInterval[];
  chunks: PlannedChunk[];
}
