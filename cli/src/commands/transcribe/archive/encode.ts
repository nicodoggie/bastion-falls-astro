import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { getAudioDurationSeconds } from "../audio.js";
import { runCommand } from "../process.js";
import {
  createFfmpegProgressHandler,
  finishProgress,
  type ProgressSink,
} from "../progress.js";

export interface BuildOpusArgsOptions {
  input: string;
  output: string;
  bitrate: string;
  force: boolean;
}

export function buildOpusArgs(options: BuildOpusArgsOptions): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-progress",
    "pipe:1",
    options.force ? "-y" : "-n",
    "-i",
    options.input,
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    options.bitrate,
    "-application",
    "voip",
    options.output,
  ];
}

export interface EncodeToOpusOptions {
  input: string;
  output: string;
  bitrate: string;
  force: boolean;
  progress?: ProgressSink;
}

export async function encodeToOpus(
  options: EncodeToOpusOptions,
): Promise<void> {
  await mkdir(dirname(options.output), { recursive: true });
  const reporter = options.progress
    ? {
        label: "Encode Opus",
        totalSeconds: await getAudioDurationSeconds(options.input),
        sink: options.progress,
      }
    : undefined;
  await runCommand("ffmpeg", buildOpusArgs(options), {
    onStdout: createFfmpegProgressHandler(reporter),
  });
  finishProgress(reporter);
}
