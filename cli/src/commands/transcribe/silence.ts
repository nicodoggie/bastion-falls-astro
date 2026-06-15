import type { PlannedChunk, SilenceInterval } from "./types.js";
import { runCommand } from "./process.js";

export interface TrimChunksToSpeechOptions {
  chunks: PlannedChunk[];
  silences: SilenceInterval[];
  paddingSeconds: number;
  minimumSpeechSeconds: number;
}

export function parseSilencedetectOutput(output: string): SilenceInterval[] {
  const intervals: SilenceInterval[] = [];
  let currentStart: number | undefined;

  for (const line of output.split(/\r?\n/)) {
    const startMatch = /silence_start:\s*([0-9.]+)/.exec(line);
    if (startMatch?.[1]) {
      currentStart = Number(startMatch[1]);
      continue;
    }

    const endMatch = /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/.exec(line);
    if (endMatch?.[1] && endMatch[2] && currentStart !== undefined) {
      intervals.push({
        start: currentStart,
        end: Number(endMatch[1]),
        duration: Number(endMatch[2]),
      });
      currentStart = undefined;
    }
  }

  return intervals;
}

export async function detectSilences(audioPath: string): Promise<SilenceInterval[]> {
  const result = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i",
    audioPath,
    "-af",
    "silencedetect=noise=-35dB:d=0.25",
    "-f",
    "null",
    "-",
  ]);
  return parseSilencedetectOutput(`${result.stdout}\n${result.stderr}`);
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function silenceCoveringStart(chunk: PlannedChunk, silences: SilenceInterval[]): SilenceInterval | undefined {
  return silences.find((silence) => silence.start <= chunk.overlapStart && silence.end > chunk.overlapStart);
}

function silenceCoveringEnd(chunk: PlannedChunk, silences: SilenceInterval[]): SilenceInterval | undefined {
  return silences.find((silence) => silence.start < chunk.overlapEnd && silence.end >= chunk.overlapEnd);
}

export function trimChunksToSpeech(options: TrimChunksToSpeechOptions): PlannedChunk[] {
  return options.chunks.flatMap((chunk) => {
    const leadingSilence = silenceCoveringStart(chunk, options.silences);
    const trailingSilence = silenceCoveringEnd(chunk, options.silences);
    const speechStart = Math.max(chunk.start, leadingSilence?.end ?? chunk.start);
    const speechEnd = Math.min(chunk.end, trailingSilence?.start ?? chunk.end);

    if (speechEnd - speechStart < options.minimumSpeechSeconds) {
      return [];
    }

    return [{
      ...chunk,
      start: roundSeconds(speechStart),
      end: roundSeconds(speechEnd),
      overlapStart: roundSeconds(Math.max(0, speechStart - options.paddingSeconds)),
      overlapEnd: roundSeconds(Math.min(chunk.overlapEnd, speechEnd + options.paddingSeconds)),
    }];
  });
}
