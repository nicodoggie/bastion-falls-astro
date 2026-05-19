import type { ChunkTranscript, PlannedChunk } from "./types.js";

export interface AssembleTranscriptOptions {
  source: string;
  backend?: string;
  model: string;
  chunks: Array<PlannedChunk & { transcript: ChunkTranscript }>;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function segmentIsInsideLogicalChunk(chunk: PlannedChunk, globalStart: number, globalEnd: number): boolean {
  const midpoint = (globalStart + globalEnd) / 2;
  return midpoint >= chunk.start && midpoint <= chunk.end;
}

export function formatChunkTranscript(chunk: PlannedChunk & { transcript: ChunkTranscript }): string {
  const lines: string[] = [];
  for (const segment of chunk.transcript.segments) {
    const text = segment.text.trim();
    if (!text) {
      continue;
    }

    const globalStart = chunk.overlapStart + segment.start;
    const globalEnd = chunk.overlapStart + segment.end;
    if (!segmentIsInsideLogicalChunk(chunk, globalStart, globalEnd)) {
      continue;
    }

    lines.push(`[${formatTimestamp(globalStart)} - ${formatTimestamp(globalEnd)}] ${text}`);
  }

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function assembleTranscript(options: AssembleTranscriptOptions): string {
  const lines = [
    "# Session Transcript",
    "",
    `Source: ${options.source}`,
    `Transcription: ${options.backend ?? "faster-whisper"} ${options.model}`,
    "",
  ];

  let previousText = "";
  for (const chunk of options.chunks) {
    for (const line of formatChunkTranscript(chunk).trim().split("\n")) {
      const text = line.replace(/^\[[^\]]+\]\s*/, "").trim();
      if (!text) {
        continue;
      }

      if (text === previousText) {
        continue;
      }

      lines.push(line);
      previousText = text;
    }
  }

  return `${lines.join("\n")}\n`;
}
