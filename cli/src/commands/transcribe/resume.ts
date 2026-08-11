import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TranscriptionPass } from "./passes.js";
import { chunkAudioPathFor } from "./passes.js";

import type {
  AudioPreparationSettings,
  AudioProbeMetadata,
  ChunkSettings,
  Manifest,
  ManifestChannel,
  SourceFingerprint,
} from "./types.js";

export function canReusePreparedAudio(
  shouldResume: boolean,
  manifest: Manifest | undefined,
): manifest is Manifest {
  return shouldResume && manifest !== undefined;
}

export function canReuseDependentAudio(
  shouldResume: boolean,
  manifest: Manifest | undefined,
  normalizedExists: boolean,
): manifest is Manifest {
  return canReusePreparedAudio(shouldResume, manifest) && normalizedExists;
}

export function shouldOverwritePreparedAudio(
  force: boolean,
  shouldResume: boolean,
  reusedNormalizedAudio: boolean,
): boolean {
  return force || (shouldResume && !reusedNormalizedAudio);
}

export function shouldOverwritePreparedChannels(
  overwritePreparedAudio: boolean,
  shouldResume: boolean,
  reusedNormalizedAudio: boolean,
  allChannelsExist: boolean,
): boolean {
  return overwritePreparedAudio ||
    (shouldResume && reusedNormalizedAudio && !allChannelsExist);
}

export function mergeCompletedByPass(options: {
  requiredPassIds: string[];
  availableByPass: Record<string, number[]>;
  retainedByPass: Record<string, number[]>;
  currentByPass: Record<string, number[]>;
  validArtifactIndexesByPass?: Record<string, number[]>;
}): Record<string, number[]> {
  return Object.fromEntries(options.requiredPassIds.map((id) => {
    const available = new Set(options.availableByPass[id] ?? []);
    const validArtifacts = options.validArtifactIndexesByPass?.[id];
    const valid = validArtifacts ? new Set(validArtifacts) : undefined;
    const merged = new Set([
      ...(options.retainedByPass[id] ?? []),
      ...(options.currentByPass[id] ?? []),
    ].filter((index) => available.has(index) && (!valid || valid.has(index))));
    return [id, [...merged].sort((a, b) => a - b)];
  }));
}

export function chunkPathForIndex(chunksDir: string, index: number): string {
  return join(chunksDir, `session_${String(index).padStart(3, "0")}.flac`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeNumber(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}

function positiveNumber(value: unknown): value is number {
  return finiteNumber(value) && value > 0;
}

function positiveInteger(value: unknown): value is number {
  return positiveNumber(value) && Number.isInteger(value);
}

function requireNumber(object: Record<string, unknown>, key: string): void {
  if (!finiteNumber(object[key])) throw new Error(`missing or invalid ${key}`);
}

function validateManifest(value: unknown): Manifest {
  if (!isObject(value)) throw new Error("manifest must be a JSON object");
  if (value["version"] !== 2) {
    throw new Error("manifest is unversioned or v1; rebuild with --force");
  }
  for (const key of ["source", "normalizedStereo"]) {
    if (typeof value[key] !== "string" || value[key] === "") {
      throw new Error(`missing or invalid ${key}`);
    }
  }
  const fingerprint = value["sourceFingerprint"];
  if (!isObject(fingerprint)) throw new Error("missing sourceFingerprint");
  if (!nonNegativeNumber(fingerprint["sizeBytes"]) || !nonNegativeNumber(fingerprint["mtimeMs"])) {
    throw new Error("invalid sourceFingerprint");
  }
  const probe = value["sourceProbe"];
  if (!isObject(probe)) throw new Error("missing sourceProbe");
  if (!positiveNumber(probe["durationSeconds"]) || !positiveInteger(probe["sampleRate"])) {
    throw new Error("invalid sourceProbe duration or sampleRate");
  }
  requireNumber(probe, "channels");
  const probeChannels = probe["channels"];
  if (typeof probeChannels !== "number" || !Number.isInteger(probeChannels) || probeChannels < 1) {
    throw new Error("invalid sourceProbe.channels");
  }
  const preparedChannels = value["preparedChannels"];
  if (!Array.isArray(preparedChannels)) {
    throw new Error("missing preparedChannels");
  }
  if (preparedChannels.length !== (probeChannels > 1 ? probeChannels : 0)) {
    throw new Error("invalid preparedChannels count");
  }
  for (const [index, channel] of preparedChannels.entries()) {
    if (!isObject(channel) || typeof channel["id"] !== "string" ||
        !Number.isInteger(channel["index"]) || channel["index"] !== index ||
        typeof channel["path"] !== "string" || channel["path"] === "") {
      throw new Error("invalid preparedChannels entry");
    }
    const expectedId = probeChannels === 2
      ? (index === 0 ? "left" : "right")
      : `channel-${index}`;
    if (channel["id"] !== expectedId) throw new Error("invalid preparedChannels id");
  }
  for (const settingsKey of ["audioSettings", "chunkSettings"]) {
    if (!isObject(value[settingsKey])) throw new Error(`missing ${settingsKey}`);
  }
  const audioSettings = value["audioSettings"] as Record<string, unknown>;
  for (const key of ["denoise", "voiceBoost"] as const) {
    if (typeof audioSettings[key] !== "boolean") {
      throw new Error(`invalid audioSettings.${key}`);
    }
  }
  if (!positiveInteger(audioSettings["sampleRate"])) {
    throw new Error("invalid audioSettings.sampleRate");
  }
  const chunkSettings = value["chunkSettings"] as Record<string, unknown>;
  if (!positiveNumber(chunkSettings["chunkSeconds"])) {
    throw new Error("invalid chunkSettings.chunkSeconds");
  }
  for (const key of ["boundarySearchSeconds", "boundaryMaxSearchSeconds", "overlapSeconds", "silencePaddingSeconds", "minimumSpeechSeconds"] as const) {
    if (!nonNegativeNumber(chunkSettings[key])) {
      throw new Error(`invalid chunkSettings.${key}`);
    }
  }
  const boundarySearchSeconds = chunkSettings["boundarySearchSeconds"] as number;
  const boundaryMaxSearchSeconds = chunkSettings["boundaryMaxSearchSeconds"] as number;
  if (boundaryMaxSearchSeconds < boundarySearchSeconds) {
    throw new Error("invalid chunkSettings boundary search range");
  }
  if (typeof chunkSettings["keepSilence"] !== "boolean") {
    throw new Error("invalid chunkSettings.keepSilence");
  }
  if (!positiveNumber(value["durationSeconds"])) throw new Error("invalid durationSeconds");
  const durationSeconds = value["durationSeconds"] as number;
  const chunks = value["chunks"];
  if (!Array.isArray(chunks) || chunks.length === 0) throw new Error("missing chunks");
  if ("channelLayout" in probe &&
      (typeof probe["channelLayout"] !== "string" || probe["channelLayout"] === "")) {
    throw new Error("invalid sourceProbe.channelLayout");
  }
  const validEndReasons = new Set([
    "nearby-silence",
    "widened-silence",
    "exact-target",
    "duration-end",
  ]);
  for (const [index, chunk] of chunks.entries()) {
    if (!isObject(chunk) || !Number.isInteger(chunk["index"]) ||
        chunk["index"] !== index ||
        !["start", "end", "overlapStart", "overlapEnd"].every((key) => finiteNumber(chunk[key])) ||
        typeof chunk["endReason"] !== "string" ||
        !validEndReasons.has(chunk["endReason"])) {
      throw new Error("invalid chunks entry");
    }
    const start = chunk["start"] as number;
    const end = chunk["end"] as number;
    const overlapStart = chunk["overlapStart"] as number;
    const overlapEnd = chunk["overlapEnd"] as number;
    if (overlapStart < 0 || overlapStart > start || start >= end || end > overlapEnd || overlapEnd > durationSeconds) {
      throw new Error("invalid chunk bounds");
    }
  }
  return value as unknown as Manifest;
}

export async function readManifest(path: string): Promise<Manifest | undefined> {
  if (!(await exists(path))) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error(`Cannot read manifest at ${path}; rebuild with --force.`);
  }
  try {
    return validateManifest(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid structure";
    throw new Error(`Cannot resume from ${path}: ${detail}; rebuild with --force.`);
  }
}

export interface ManifestCompatibilityInput {
  source: string;
  sourceFingerprint: SourceFingerprint;
  sourceProbe: AudioProbeMetadata;
  normalizedStereo: string;
  preparedChannels: ManifestChannel[];
  audioSettings: AudioPreparationSettings;
  chunkSettings: ChunkSettings;
}

export function manifestCompatibilityIssues(
  manifest: Manifest,
  current: ManifestCompatibilityInput,
): string[] {
  const issues: string[] = [];
  for (const key of ["source", "normalizedStereo"] as const) {
    if (manifest[key] !== current[key]) issues.push(`${key} changed`);
  }
  if (JSON.stringify(manifest.sourceFingerprint) !== JSON.stringify(current.sourceFingerprint)) issues.push("source fingerprint changed");
  if (JSON.stringify(manifest.sourceProbe) !== JSON.stringify(current.sourceProbe)) issues.push("source probe changed");
  if (JSON.stringify(manifest.preparedChannels) !== JSON.stringify(current.preparedChannels)) issues.push("prepared channel identities or paths changed");
  if (JSON.stringify(manifest.audioSettings) !== JSON.stringify(current.audioSettings)) issues.push("audio settings changed");
  if (JSON.stringify(manifest.chunkSettings) !== JSON.stringify(current.chunkSettings)) issues.push("chunk settings changed");
  return issues;
}

export async function canReuseAudioChunks(options: {
  manifest: Manifest;
  chunksDir: string;
}): Promise<{ reusable: boolean; chunkPaths: string[]; missingIndexes: number[] }> {
  const chunkPaths = options.manifest.chunks.map((chunk) => chunkPathForIndex(options.chunksDir, chunk.index));
  const missingIndexes: number[] = [];

  await Promise.all(
    chunkPaths.map(async (chunkPath, index) => {
      if (!(await exists(chunkPath))) {
        const chunk = options.manifest.chunks[index];
        missingIndexes.push(chunk?.index ?? index);
      }
    }),
  );
  missingIndexes.sort((a, b) => a - b);

  return {
    reusable: missingIndexes.length === 0,
    chunkPaths,
    missingIndexes,
  };
}

export interface PassAudioReuseResult {
  reusable: boolean;
  pathsByPass: Record<string, string[]>;
  missingIndexesByPass: Record<string, number[]>;
  missingPathsByPass: Record<string, string[]>;
}

/** Validate every required pass against the one shared Manifest v2 plan. */
export async function canReusePassAudioChunks(options: {
  manifest: Manifest;
  chunksRoot: string;
  passes: TranscriptionPass[];
}): Promise<PassAudioReuseResult> {
  const pathsByPass: Record<string, string[]> = {};
  const missingIndexesByPass: Record<string, number[]> = {};
  const missingPathsByPass: Record<string, string[]> = {};
  await Promise.all(options.passes.map(async (pass) => {
    const paths = options.manifest.chunks.map((chunk) => chunkAudioPathFor(options.chunksRoot, pass, chunk.index));
    const missing = await Promise.all(paths.map(async (path, index) =>
      (await exists(path)) ? undefined : { index: options.manifest.chunks[index]!.index, path }));
    const missingEntries = missing.filter((entry): entry is { index: number; path: string } => entry !== undefined);
    pathsByPass[pass.id] = paths;
    missingIndexesByPass[pass.id] = missingEntries.map((entry) => entry.index).sort((a, b) => a - b);
    missingPathsByPass[pass.id] = missingEntries.map((entry) => entry.path);
  }));
  return {
    reusable: Object.values(missingIndexesByPass).every((missing) => missing.length === 0),
    pathsByPass,
    missingIndexesByPass,
    missingPathsByPass,
  };
}

