import type { ChunkTranscript, PlannedChunk, SilenceInterval } from "./types.js";

export interface AssembleTranscriptOptions {
  source: string;
  backend?: string;
  model: string;
  chunks: Array<PlannedChunk & { transcript: ChunkTranscript }>;
  silences?: SilenceInterval[];
  silenceTagMinimumSeconds?: number;
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

  const transcriptEvents = options.chunks.flatMap((chunk) => {
    return formatChunkTranscript(chunk)
      .trim()
      .split("\n")
      .map((line) => {
        const match = /^\[(\d\d):(\d\d):(\d\d) -/.exec(line);
        const start = match
          ? Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])
          : Number.MAX_SAFE_INTEGER;
        return { type: "transcript" as const, start, line };
      });
  });
  const silenceEvents = (options.silences ?? [])
    .filter((silence) => silence.duration >= (options.silenceTagMinimumSeconds ?? Number.POSITIVE_INFINITY))
    .map((silence) => ({
      type: "silence" as const,
      start: silence.start,
      line: `[${formatTimestamp(silence.start)} - ${formatTimestamp(silence.end)}] [extended silence: ${Math.round(silence.duration)}s]`,
    }));
  const events = [...transcriptEvents, ...silenceEvents]
    .filter((event) => event.line.trim())
    .sort((a, b) => a.start - b.start || (a.type === "silence" ? -1 : 1));

  let previousText = "";
  for (const event of events) {
    if (event.type === "silence") {
      lines.push(event.line);
      previousText = "";
      continue;
    }

    const line = event.line;
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

  return `${lines.join("\n")}\n`;
}
