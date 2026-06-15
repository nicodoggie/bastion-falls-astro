import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PlannedChunk } from "./types.js";
import { runCommand } from "./process.js";
import { createFfmpegProgressHandler, finishProgress, type ProgressSink } from "./progress.js";

export interface AudioFilterOptions {
  denoise?: boolean;
  voiceBoost?: boolean;
}

export function buildAudioFilter(options: AudioFilterOptions): string {
  return [
    options.denoise ? "afftdn" : undefined,
    "highpass=f=80",
    "lowpass=f=8000",
    options.voiceBoost ? "equalizer=f=3000:t=q:w=1:g=3" : undefined,
    "loudnorm=I=-16:TP=-1.5:LRA=11",
  ].filter(Boolean).join(",");
}

export async function getAudioDurationSeconds(audioPath: string): Promise<number> {
  const result = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    audioPath,
  ]);
  const parsed = JSON.parse(result.stdout) as { format?: { duration?: string } };
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine duration for ${audioPath}`);
  }
  return duration;
}

export async function normalizeToFlac(
  inputPath: string,
  outputPath: string,
  force: boolean,
  filters: AudioFilterOptions,
  progress?: { sink: ProgressSink; totalSeconds: number },
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const reporter = progress ? { label: "Normalize", ...progress } : undefined;
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-progress",
    "pipe:1",
    force ? "-y" : "-n",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-af",
    buildAudioFilter(filters),
    "-compression_level",
    "8",
    outputPath,
  ], {
    onStdout: createFfmpegProgressHandler(reporter),
  });
  finishProgress(reporter);
}

export async function writeChunkFlacs(
  normalizedPath: string,
  chunksDir: string,
  chunks: PlannedChunk[],
  force: boolean,
  progress?: { sink: ProgressSink },
): Promise<string[]> {
  await mkdir(chunksDir, { recursive: true });
  const paths: string[] = [];
  for (const chunk of chunks) {
    const chunkPath = join(chunksDir, `session_${String(chunk.index).padStart(3, "0")}.flac`);
    const reporter = progress
      ? {
          label: `Chunk ${chunk.index + 1}/${chunks.length}`,
          totalSeconds: chunk.overlapEnd - chunk.overlapStart,
          sink: progress.sink,
        }
      : undefined;
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-progress",
      "pipe:1",
      force ? "-y" : "-n",
      "-ss",
      String(chunk.overlapStart),
      "-to",
      String(chunk.overlapEnd),
      "-i",
      normalizedPath,
      "-vn",
      "-c:a",
      "flac",
      "-compression_level",
      "8",
      chunkPath,
    ], {
      onStdout: createFfmpegProgressHandler(reporter),
    });
    finishProgress(reporter);
    paths.push(chunkPath);
  }
  return paths;
}
