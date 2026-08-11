import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PlannedChunk } from "./types.js";
import type { TranscriptionPass } from "./passes.js";
import { chunkAudioPathFor } from "./passes.js";
import { runCommand } from "./process.js";
import {
  createFfmpegProgressHandler,
  finishProgress,
  type ProgressSink,
} from "./progress.js";

export interface AudioFilterOptions {
  denoise?: boolean;
  voiceBoost?: boolean;
}

export interface AudioStreamInfo {
  durationSeconds: number;
  channels: number;
  channelLayout?: string;
  sampleRate: number;
}

export interface PreparedChannel {
  id: string;
  index: number;
  path: string;
}

export function buildAudioFilter(options: AudioFilterOptions): string {
  return [
    options.denoise ? "afftdn" : undefined,
    "highpass=f=80",
    "lowpass=f=8000",
    options.voiceBoost ? "equalizer=f=3000:t=q:w=1:g=3" : undefined,
    "loudnorm=I=-16:TP=-1.5:LRA=11",
  ]
    .filter(Boolean)
    .join(",");
}

export function parseAudioProbe(output: string, audioPath: string): AudioStreamInfo {
  let parsed: {
    format?: { duration?: string | number };
    streams?: Array<{
      codec_type?: string;
      duration?: string | number;
      channels?: number;
      channel_layout?: string;
      sample_rate?: string | number;
    }>;
  };
  try {
    parsed = JSON.parse(output) as typeof parsed;
  } catch (error) {
    throw new Error(
      `Could not parse ffprobe metadata for ${audioPath}`,
      { cause: error },
    );
  }
  const stream =
    parsed.streams?.find((candidate) => candidate.codec_type === "audio") ??
    parsed.streams?.[0];
  const durationSeconds = [stream?.duration, parsed.format?.duration]
    .map(Number)
    .find((duration) => Number.isFinite(duration) && duration > 0);
  const channels = Number(stream?.channels);
  const sampleRate = Number(stream?.sample_rate);
  if (
    durationSeconds === undefined ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isInteger(channels) ||
    channels <= 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    throw new Error(`Could not determine audio metadata for ${audioPath}`);
  }
  return {
    durationSeconds,
    channels,
    channelLayout: stream?.channel_layout,
    sampleRate,
  };
}

export async function probeAudio(audioPath: string): Promise<AudioStreamInfo> {
  const result = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,duration,channels,channel_layout,sample_rate:format=duration",
    "-of",
    "json",
    audioPath,
  ]);
  return parseAudioProbe(result.stdout, audioPath);
}

export async function getAudioDurationSeconds(
  audioPath: string,
): Promise<number> {
  return (await probeAudio(audioPath)).durationSeconds;
}

export async function normalizeToFlac(
  inputPath: string,
  outputPath: string,
  force: boolean,
  filters: AudioFilterOptions,
  progress?: { sink: ProgressSink; totalSeconds: number },
  outputChannels?: number,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const reporter = progress ? { label: "Normalize", ...progress } : undefined;
  await runCommand(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-progress",
      "pipe:1",
      force ? "-y" : "-n",
      "-i",
      inputPath,
      "-vn",
      ...(outputChannels === undefined ? [] : ["-ac", String(outputChannels)]),
      "-ar",
      "16000",
      "-af",
      buildAudioFilter(filters),
      "-compression_level",
      "8",
      outputPath,
    ],
    { onStdout: createFfmpegProgressHandler(reporter) },
  );
  finishProgress(reporter);
}

export function channelId(index: number, channelCount: number): string {
  if (channelCount === 2) return index === 0 ? "left" : "right";
  return `channel-${index}`;
}

export async function deriveMonoChannels(options: {
  stereoPath: string;
  channelsDir: string;
  channelCount: number;
  force: boolean;
  progress?: { sink: ProgressSink };
}): Promise<PreparedChannel[]> {
  if (!Number.isInteger(options.channelCount) || options.channelCount < 1) {
    throw new Error(`Invalid channel count: ${options.channelCount}`);
  }
  await mkdir(options.channelsDir, { recursive: true });
  const sourceInfo = options.progress
    ? await probeAudio(options.stereoPath)
    : undefined;
  const prepared: PreparedChannel[] = [];
  for (let index = 0; index < options.channelCount; index += 1) {
    const id = channelId(index, options.channelCount);
    const path = join(options.channelsDir, `${id}.flac`);
    const reporter = options.progress
      ? {
          label: `Channel ${index + 1}/${options.channelCount}`,
          totalSeconds: sourceInfo?.durationSeconds ?? 0,
          sink: options.progress.sink,
        }
      : undefined;
    await runCommand(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-progress",
        "pipe:1",
        options.force ? "-y" : "-n",
        "-i",
        options.stereoPath,
        "-vn",
        "-af",
        `pan=mono|c0=c${index}`,
        "-ar",
        "16000",
        "-c:a",
        "flac",
        "-compression_level",
        "8",
        path,
      ],
      { onStdout: createFfmpegProgressHandler(reporter) },
    );
    finishProgress(reporter);
    prepared.push({ id, index, path });
  }
  return prepared;
}

export async function writeChunkFlacs(
  normalizedPath: string,
  chunksDir: string,
  chunks: PlannedChunk[],
  force: boolean,
  progress?: { sink: ProgressSink },
  pass: TranscriptionPass = { kind: "stereo", id: "stereo" },
): Promise<string[]> {
  await mkdir(chunksDir, { recursive: true });
  const paths: string[] = [];
  for (const chunk of chunks) {
    const chunkPath = chunkAudioPathFor(chunksDir, pass, chunk.index);
    await mkdir(dirname(chunkPath), { recursive: true });
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
