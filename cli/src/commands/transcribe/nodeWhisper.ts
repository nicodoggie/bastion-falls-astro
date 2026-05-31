import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import type { ChunkTranscript, TranscriptSegment } from "./types.js";

export interface NodeWhisperOptions {
  chunkPaths: string[];
  outDir: string;
  model: string;
  modelRootPath?: string;
  autoDownloadModel: boolean;
  device: string;
  force: boolean;
}

interface NodeWhisperRow {
  start?: string | number;
  end?: string | number;
  speech?: string;
  text?: string;
  confidence?: number;
  avg_logprob?: number;
  avgLogprob?: number;
  compression_ratio?: number;
  compressionRatio?: number;
  no_speech_prob?: number;
  noSpeechProb?: number;
  temperature?: number;
  timestamps?: {
    from?: string | number;
    to?: string | number;
  };
}

const quietLogger = {
  debug: () => {},
  log: (...args: unknown[]) => console.log(...args),
  error: () => {},
};

export function parseNodeWhisperTimestamp(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const match = /(\d+):(\d+):(\d+(?:[\.,]\d+)?)/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    return Number.NaN;
  }

  return Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3].replace(",", "."));
}

export function convertNodeWhisperRows(rows: NodeWhisperRow[], chunkName: string): ChunkTranscript & { chunk: string } {
  const segments: TranscriptSegment[] = [];
  for (const row of rows) {
    const rawStart = row.start ?? row.timestamps?.from;
    const rawEnd = row.end ?? row.timestamps?.to;
    if (rawStart === undefined || rawEnd === undefined) {
      continue;
    }
    const start = parseNodeWhisperTimestamp(rawStart);
    const end = parseNodeWhisperTimestamp(rawEnd);
    const text = (row.speech ?? row.text ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) {
      continue;
    }
    const segment: TranscriptSegment = { start, end, text };
    if (Number.isFinite(row.confidence)) {
      segment.confidence = row.confidence;
    }
    const avgLogprob = row.avgLogprob ?? row.avg_logprob;
    if (Number.isFinite(avgLogprob)) {
      segment.avgLogprob = avgLogprob;
    }
    const compressionRatio = row.compressionRatio ?? row.compression_ratio;
    if (Number.isFinite(compressionRatio)) {
      segment.compressionRatio = compressionRatio;
    }
    const noSpeechProb = row.noSpeechProb ?? row.no_speech_prob;
    if (Number.isFinite(noSpeechProb)) {
      segment.noSpeechProb = noSpeechProb;
    }
    if (Number.isFinite(row.temperature)) {
      segment.temperature = row.temperature;
    }
    segments.push(segment);
  }
  return { chunk: chunkName, segments };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readNodeWhisperJson(chunkPath: string): Promise<unknown> {
  const extension = extname(chunkPath);
  const wavPath = `${chunkPath.slice(0, -extension.length)}.wav`;
  const candidates = [
    `${chunkPath}.json`,
    `${chunkPath}.json.full`,
    `${wavPath}.json`,
    `${wavPath}.json.full`,
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      const parsed = JSON.parse(await readFile(candidate, "utf8")) as unknown;
      await rm(candidate, { force: true });
      return parsed;
    }
  }

  throw new Error(`nodejs-whisper did not produce a JSON transcript for ${chunkPath}`);
}

function rowsFromJson(parsed: unknown): NodeWhisperRow[] {
  if (Array.isArray(parsed)) {
    return parsed as NodeWhisperRow[];
  }
  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record["transcription"])) {
      return record["transcription"] as NodeWhisperRow[];
    }
    if (Array.isArray(record["segments"])) {
      return record["segments"] as NodeWhisperRow[];
    }
  }
  return [];
}

export async function transcribeChunksWithNodeWhisper(options: NodeWhisperOptions): Promise<string[]> {
  await mkdir(options.outDir, { recursive: true });
  const { nodewhisper } = await import("nodejs-whisper");
  const jsonPaths: string[] = [];

  for (const chunkPath of options.chunkPaths) {
    const outPath = join(options.outDir, `${basename(chunkPath, extname(chunkPath))}.json`);
    if ((await pathExists(outPath)) && !options.force) {
      console.log(`skip ${basename(chunkPath)}`);
      jsonPaths.push(outPath);
      continue;
    }

    console.log(`transcribe ${basename(chunkPath)}`);
    try {
      await nodewhisper(chunkPath, {
        modelName: options.model,
        modelRootPath: options.modelRootPath,
        autoDownloadModelName: options.autoDownloadModel ? options.model : undefined,
        removeWavFileAfterTranscription: true,
        withCuda: options.device === "cuda",
        logger: quietLogger,
        whisperOptions: {
          outputInJson: true,
          language: "auto",
          noGpu: options.device === "cpu",
        },
      });
    } catch (error) {
      if (!(await nodeWhisperJsonExists(chunkPath))) {
        throw error;
      }
    }

    const parsed = await readNodeWhisperJson(chunkPath);
    await cleanupNodeWhisperWav(chunkPath);
    const transcript = convertNodeWhisperRows(rowsFromJson(parsed), basename(chunkPath));
    await writeFile(outPath, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
    jsonPaths.push(outPath);
  }

  return jsonPaths;
}

async function cleanupNodeWhisperWav(chunkPath: string): Promise<void> {
  const extension = extname(chunkPath);
  const wavPath = `${chunkPath.slice(0, -extension.length)}.wav`;
  await rm(wavPath, { force: true });
}

async function nodeWhisperJsonExists(chunkPath: string): Promise<boolean> {
  const extension = extname(chunkPath);
  const wavPath = `${chunkPath.slice(0, -extension.length)}.wav`;
  const candidates = [`${chunkPath}.json`, `${chunkPath}.json.full`, `${wavPath}.json`, `${wavPath}.json.full`];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}
