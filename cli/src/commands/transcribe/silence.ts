import type { SilenceInterval } from "./types.js";
import { runCommand } from "./process.js";

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

