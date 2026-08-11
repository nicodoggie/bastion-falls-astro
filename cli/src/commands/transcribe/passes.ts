import { join } from "node:path";

import type { PreparedChannel } from "./audio.js";

export type TranscriptionPass =
  | { kind: "stereo"; id: "stereo" }
  | { kind: "channel"; id: string; channelIndex: number };

const SAFE_PASS_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertTranscriptionPass(pass: unknown): asserts pass is TranscriptionPass {
  if (!pass || typeof pass !== "object" || Array.isArray(pass)) throw new Error("invalid transcription pass");
  const candidate = pass as { kind?: unknown; id?: unknown; channelIndex?: unknown };
  if (candidate.kind === "stereo") {
    if (candidate.id !== "stereo" || Object.keys(candidate).some((key) => key !== "kind" && key !== "id")) {
      throw new Error("invalid stereo transcription pass");
    }
    return;
  }
  if (candidate.kind !== "channel" || typeof candidate.id !== "string" ||
      candidate.id === "stereo" || !SAFE_PASS_ID.test(candidate.id) ||
      typeof candidate.channelIndex !== "number" || !Number.isSafeInteger(candidate.channelIndex) || candidate.channelIndex < 0 ||
      Object.keys(candidate).some((key) => !["kind", "id", "channelIndex"].includes(key))) {
    throw new Error("invalid channel transcription pass");
  }
}

function validateAvailableIndexes(availableIndexes: number[]): number[] {
  if (availableIndexes.some((index) => !Number.isInteger(index) || index < 0)) {
    throw new Error("chunk selection available indexes must be non-negative integers");
  }
  const sorted = [...availableIndexes].sort((a, b) => a - b);
  if (new Set(sorted).size !== sorted.length) {
    throw new Error("chunk selection available indexes must not contain duplicates");
  }
  return sorted;
}

export function parseChunkSelection(value: string | undefined, availableIndexes: number[]): number[] {
  const available = validateAvailableIndexes(availableIndexes);
  const availableSet = new Set(available);
  if (value === undefined) return available;
  if (value.trim() === "") throw new Error("Invalid chunk selection: empty selector");
  const selected = new Set<number>();
  for (const token of value.split(",")) {
    if (token.trim() === "") throw new Error("Invalid chunk selection: empty token");
    const range = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!range) throw new Error(`Invalid chunk selection token: ${token}`);
    const start = Number(range[1]);
    const end = range[2] === undefined ? start : Number(range[2]);
    if (end < start) throw new Error(`Invalid chunk selection range: ${token}`);
    for (let index = start; index <= end; index += 1) {
      if (!availableSet.has(index)) throw new Error(`Invalid chunk selection: index ${index} is unavailable`);
      selected.add(index);
    }
  }
  return [...selected].sort((a, b) => a - b);
}

export function requiredPasses(layout: "stereo" | "hybrid", channels: PreparedChannel[]): TranscriptionPass[] {
  const ordered = [...channels].sort((a, b) => a.index - b.index);
  if (ordered.some((channel, index) => channel.index !== index ||
      typeof channel.id !== "string" || !SAFE_PASS_ID.test(channel.id) || channel.id === "stereo" ||
      !Number.isInteger(channel.index) || channel.index < 0)) {
    throw new Error("prepared channels must have stable contiguous indexes and non-empty IDs");
  }
  if (new Set(ordered.map((channel) => channel.id)).size !== ordered.length) {
    throw new Error("prepared channels must have unique IDs");
  }
  const passes: TranscriptionPass[] = [{ kind: "stereo", id: "stereo" }];
  if (layout === "hybrid") {
    passes.push(...ordered.map((channel): TranscriptionPass => ({ kind: "channel", id: channel.id, channelIndex: channel.index })));
  }
  return passes;
}

export function pairChunksWithArtifactPaths<T extends { index: number }>(
  chunks: T[],
  artifactPaths: string[],
): Array<{ chunk: T; artifactPath: string }> {
  if (chunks.length !== artifactPaths.length) {
    throw new Error("chunk artifact count must match the selected chunk count");
  }
  return chunks.map((chunk, index) => ({
    chunk,
    artifactPath: artifactPaths[index]!,
  }));
}

function passDir(root: string, pass: TranscriptionPass): string {
  assertTranscriptionPass(pass);
  return pass.kind === "stereo" ? root : join(root, "passes", pass.id);
}

function chunkFile(index: number, extension: string): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid chunk index: ${index}`);
  return `session_${String(index).padStart(3, "0")}.${extension}`;
}

export function chunkAudioPathFor(root: string, pass: TranscriptionPass, index: number): string {
  return join(passDir(root, pass), chunkFile(index, "flac"));
}

export function passRawJsonPathFor(root: string, pass: TranscriptionPass, index: number): string {
  return join(passDir(root, pass), chunkFile(index, "json"));
}

export function passRawMarkdownPathFor(root: string, pass: TranscriptionPass, index: number): string {
  return join(passDir(root, pass), chunkFile(index, "md"));
}

export function passAlignmentPathFor(root: string, pass: TranscriptionPass): string {
  assertTranscriptionPass(pass);
  return join(root, "alignment", `${pass.id}.json`);
}
