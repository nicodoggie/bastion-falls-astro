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

export interface Manifest {
  source: string;
  normalized: string;
  durationSeconds: number;
  chunkSeconds: number;
  boundarySearchSeconds: number;
  boundaryMaxSearchSeconds: number;
  overlapSeconds: number;
  silences?: SilenceInterval[];
  chunks: PlannedChunk[];
}
