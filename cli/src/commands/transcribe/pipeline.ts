import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { assembleTranscript, formatChunkTranscript } from "./assembly.js";
import { writeTranscribeCheckpoint, type TranscribeCheckpoint } from "./checkpoint.js";
import { parseChunkSelection, chunkAudioPathFor, passRawJsonPathFor, passRawMarkdownPathFor, requiredPasses, type TranscriptionPass } from "./passes.js";
import { transcribePass, type SttBackendDependencies } from "./sttBackend.js";
import type { ResolvedTranscriptionProfile } from "./settings.js";
import { parseChunkTranscript, type Manifest } from "./types.js";

let atomicWriteCounter = 0;

export const transcribeStages = [
  "normalization",
  "audio-chunking",
  "transcription",
  "raw-assembly",
  "correction-review",
  "notes",
] as const;
export type TranscribeStage = typeof transcribeStages[number];

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export interface SttCacheIdentityInput {
  manifest: Manifest;
  pass: TranscriptionPass;
  target: ResolvedTranscriptionProfile["target"];
  language: string;
  prompt?: string;
}

export function sttCacheIdentity(input: SttCacheIdentityInput): string {
  const target = input.target.provider === "openai-compatible"
    ? (() => {
        const url = new URL(input.target.baseUrl);
        return { name: input.target.name, provider: input.target.provider, baseUrl: `${url.origin}${url.pathname || "/"}`, model: input.target.model };
      })()
    : { name: input.target.name, provider: input.target.provider, model: input.target.model };
  return stable({
    version: 1,
    source: input.manifest.sourceFingerprint,
    audio: { source: input.manifest.source, audioSettings: input.manifest.audioSettings, chunkSettings: input.manifest.chunkSettings },
    pass: input.pass,
    target,
    language: input.language,
    prompt: input.prompt ?? null,
  });
}

export function parseStopAfter(value: string | undefined): TranscribeStage | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/_/g, "-");
  if ((transcribeStages as readonly string[]).includes(normalized)) return normalized as TranscribeStage;
  throw new Error(`Unsupported --stop-after stage: ${value}. Expected one of ${transcribeStages.join(", ")}`);
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function atomicText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${++atomicWriteCounter}-${Math.random().toString(36).slice(2)}`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

async function validPair(jsonPath: string, markdownPath: string): Promise<boolean> {
  try {
    parseChunkTranscript(JSON.parse(await readFile(jsonPath, "utf8")) as unknown);
    const markdown = await readFile(markdownPath, "utf8");
    return markdown.trim().length > 0;
  } catch { return false; }
}

export interface PreparedPipelineContext {
  manifest: Manifest;
  profile: ResolvedTranscriptionProfile;
  rawChunksDir: string;
  rawTranscriptionDir: string;
  chunksDir: string;
  source: string;
  backend?: string;
  model?: string;
  silenceTagMinimumSeconds?: number;
}

export interface TranscriptionPipelineOptions extends Omit<PreparedPipelineContext, "manifest" | "profile"> {
  manifest?: Manifest;
  profile?: ResolvedTranscriptionProfile;
  checkpoint: TranscribeCheckpoint;
  checkpointPath: string;
  rawChunksDir: string;
  rawTranscriptionDir: string;
  chunksDir: string;
  language: string;
  prompt?: string;
  selection?: string;
  force?: boolean;
  stopAfter?: TranscribeStage;
  source: string;
  backend?: string;
  model?: string;
  silenceTagMinimumSeconds?: number;
  dependencies?: SttBackendDependencies;
  onProgress?: (message: string) => void;
  stages?: {
    normalization?: () => Promise<void>;
    audioChunking?: () => Promise<void>;
    rawAssembly?: () => Promise<void>;
    correctionReview?: () => Promise<"complete" | "skipped">;
    notes?: () => Promise<"complete" | "skipped">;
  };
}

export interface TranscriptionPipelineResult {
  checkpoint: TranscribeCheckpoint;
  selected: number[];
  passes: TranscriptionPass[];
}

function transcriptionStatus(completed: Record<string, number[]>, available: Record<string, number[]>): "complete" | "in_progress" {
  return Object.keys(available).every((id) => (completed[id] ?? []).length === (available[id] ?? []).length) ? "complete" : "in_progress";
}

export async function executePreparedTranscription(options: TranscriptionPipelineOptions & { manifest: Manifest; profile: ResolvedTranscriptionProfile }): Promise<TranscriptionPipelineResult> {
  const passes = requiredPasses(options.profile.layout, options.manifest.preparedChannels);
  options.checkpoint.profile = options.profile.name;
  options.checkpoint.layout = options.profile.layout;
  const available = options.manifest.chunks.map((chunk) => chunk.index);
  const selected = parseChunkSelection(options.selection, available);
  const stage = options.checkpoint.stages.transcribed_chunks;
  const availableByPass = Object.fromEntries(passes.map((pass) => [pass.id, available]));
  const identityByPass = Object.fromEntries(passes.map((pass) => [pass.id, sttCacheIdentity({ manifest: options.manifest, pass, target: options.profile.target, language: options.language, prompt: options.prompt })]));
  const previousIdentity = (stage as typeof stage & { cacheIdentityByPass?: Record<string, string> }).cacheIdentityByPass ?? {};
  const identityChanged = passes.some((pass) => previousIdentity[pass.id] !== identityByPass[pass.id]) ||
    JSON.stringify(Object.keys(previousIdentity).sort()) !== JSON.stringify(passes.map((pass) => pass.id).sort());
  const retained = stage.completedByPass;
  const completedByPass: Record<string, number[]> = Object.fromEntries(passes.map((pass) => [pass.id, []]));
  for (const pass of passes) {
    if (previousIdentity[pass.id] !== identityByPass[pass.id]) continue;
    for (const index of retained[pass.id] ?? []) {
      if (await validPair(passRawJsonPathFor(options.rawChunksDir, pass, index), passRawMarkdownPathFor(options.rawTranscriptionDir, pass, index))) completedByPass[pass.id]!.push(index);
    }
  }
  const completionChanged = passes.some((pass) =>
    JSON.stringify(retained[pass.id] ?? []) !== JSON.stringify(completedByPass[pass.id] ?? []));
  stage.requiredPasses = passes.map((pass) => pass.id);
  stage.completedByPass = completedByPass;
  stage.selection = selected;
  stage.total = options.manifest.chunks.length;
  stage.rawChunksDir = options.rawChunksDir;
  stage.rawTranscriptionDir = options.rawTranscriptionDir;
  (stage as typeof stage & { cacheIdentityByPass?: Record<string, string> }).cacheIdentityByPass = identityByPass;
  options.checkpoint.stages.audio_chunking.requiredPasses = passes.map((pass) => pass.id);
  options.checkpoint.stages.audio_chunking.availableByPass = availableByPass;
  options.checkpoint.stages.transcribed_chunks.status = transcriptionStatus(completedByPass, availableByPass);
  let downstreamInvalidated = identityChanged || completionChanged;
  const invalidateDownstream = (): void => {
    downstreamInvalidated = true;
    options.checkpoint.stages.joining_raw_transcription.status = "pending";
    options.checkpoint.stages.joining_raw_transcription.completedAt = undefined;
    options.checkpoint.stages.correction_pass.status = "pending";
    options.checkpoint.stages.correction_pass.completedAt = undefined;
    options.checkpoint.stages.notes_summary_pass.status = "pending";
    options.checkpoint.stages.notes_summary_pass.completedAt = undefined;
    options.checkpoint.stages.done.status = "pending";
    options.checkpoint.stages.done.completedAt = undefined;
  };
  if (downstreamInvalidated) invalidateDownstream();
  options.checkpoint.updatedAt = new Date().toISOString();
  await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);

  if (options.stopAfter === "audio-chunking") return { checkpoint: options.checkpoint, selected, passes };

  for (const pass of passes) {
    for (const index of selected) {
      if (completedByPass[pass.id]!.includes(index) && !options.force) continue;
      if (!downstreamInvalidated) invalidateDownstream();
      const chunk = options.manifest.chunks.find((candidate) => candidate.index === index)!;
      options.onProgress?.(`Transcribing ${pass.id} chunk ${index}\n`);
      const [transcript] = await transcribePass({
        target: options.profile.target,
        pass,
        chunks: [{ index, path: chunkAudioPathFor(options.chunksDir, pass, index) }],
        outDir: options.rawChunksDir,
        language: options.language,
        prompt: options.prompt,
        force: Boolean(options.force),
      }, options.dependencies);
      if (!transcript) throw new Error(`STT returned an invalid transcript for ${pass.id} chunk ${index}`);
      const parsedTranscript = parseChunkTranscript(transcript);
      await atomicText(passRawJsonPathFor(options.rawChunksDir, pass, index), `${JSON.stringify(parsedTranscript, null, 2)}\n`);
      const markdown = formatChunkTranscript({ ...chunk, transcript: parsedTranscript });
      if (!markdown.trim()) throw new Error(`STT produced no renderable markdown for ${pass.id} chunk ${index}`);
      await atomicText(passRawMarkdownPathFor(options.rawTranscriptionDir, pass, index), markdown);
      completedByPass[pass.id] = [...new Set([...completedByPass[pass.id]!, index])].sort((a, b) => a - b);
      stage.completedByPass = completedByPass;
      options.checkpoint.updatedAt = new Date().toISOString();
      await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
    }
  }
  const transcriptionComplete = passes.every((pass) => completedByPass[pass.id]!.length === available.length);
  stage.status = transcriptionComplete ? "complete" : "in_progress";
  options.checkpoint.updatedAt = new Date().toISOString();
  stage.completedAt = transcriptionComplete ? options.checkpoint.updatedAt : undefined;
  await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  if (options.stopAfter === "transcription" || !transcriptionComplete || options.profile.layout === "hybrid") return { checkpoint: options.checkpoint, selected, passes };

  if (options.checkpoint.stages.joining_raw_transcription.status !== "complete") {
    const stereo = passes.find((pass) => pass.kind === "stereo")!;
    const transcripts = await Promise.all(options.manifest.chunks.map(async (chunk) => ({
      ...chunk,
      transcript: parseChunkTranscript(JSON.parse(await readFile(passRawJsonPathFor(options.rawChunksDir, stereo, chunk.index), "utf8")) as unknown),
    })));
    if (options.stages?.rawAssembly) await options.stages.rawAssembly();
    else await atomicText(options.checkpoint.stages.joining_raw_transcription.path!, assembleTranscript({ source: options.source, backend: options.backend, model: options.model ?? options.profile.target.model, chunks: transcripts, silences: options.manifest.silences, silenceTagMinimumSeconds: options.silenceTagMinimumSeconds }));
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.joining_raw_transcription = { status: "complete", completedAt: options.checkpoint.updatedAt, path: options.checkpoint.stages.joining_raw_transcription.path };
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  }
  if (options.stopAfter === "raw-assembly") return { checkpoint: options.checkpoint, selected, passes };
  if (options.checkpoint.stages.correction_pass.status === "pending") {
    if (!options.stages?.correctionReview) {
      throw new Error("Missing required stages.correctionReview hook for stereo correction-review stage.");
    }
    const correctionStatus = await options.stages.correctionReview();
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.correction_pass.status = correctionStatus;
    options.checkpoint.stages.correction_pass.completedAt = options.checkpoint.updatedAt;
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  }
  if (options.stopAfter === "correction-review") return { checkpoint: options.checkpoint, selected, passes };
  if (options.checkpoint.stages.notes_summary_pass.status === "pending") {
    if (!options.stages?.notes) {
      throw new Error("Missing required stages.notes hook for stereo notes stage.");
    }
    const notesStatus = await options.stages.notes();
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.notes_summary_pass.status = notesStatus;
    options.checkpoint.stages.notes_summary_pass.completedAt = options.checkpoint.updatedAt;
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  }
  if (options.stopAfter === "notes") return { checkpoint: options.checkpoint, selected, passes };
  if (options.checkpoint.stages.done.status !== "complete") {
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.done.status = "complete";
    options.checkpoint.stages.done.completedAt = options.checkpoint.updatedAt;
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  }
  return { checkpoint: options.checkpoint, selected, passes };
}

export interface TranscriptionLifecycleOptions extends Omit<TranscriptionPipelineOptions, "manifest" | "profile"> {
  normalize: () => Promise<void>;
  prepareAudio: () => Promise<PreparedPipelineContext>;
}

/** Owns the complete normalize → prepare → transcribe → downstream lifecycle. */
export async function executeTranscriptionPipeline(options: TranscriptionLifecycleOptions): Promise<TranscriptionPipelineResult> {
  await options.normalize();
  options.checkpoint.updatedAt = new Date().toISOString();
  options.checkpoint.stages.normalization.status = "complete";
  options.checkpoint.stages.normalization.completedAt = options.checkpoint.updatedAt;
  await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  if (options.stopAfter === "normalization") return { checkpoint: options.checkpoint, selected: [], passes: [] };

  const prepared = await options.prepareAudio();
  const preparedPasses = requiredPasses(prepared.profile.layout, prepared.manifest.preparedChannels);
  const available = prepared.manifest.chunks.map((chunk) => chunk.index);
  options.checkpoint.profile = prepared.profile.name;
  options.checkpoint.layout = prepared.profile.layout;
  options.checkpoint.stages.audio_chunking.count = available.length;
  options.checkpoint.stages.audio_chunking.dir = prepared.chunksDir;
  options.checkpoint.stages.audio_chunking.requiredPasses = preparedPasses.map((pass) => pass.id);
  options.checkpoint.stages.audio_chunking.availableByPass = Object.fromEntries(preparedPasses.map((pass) => [pass.id, available]));
  const priorCompleted = options.checkpoint.stages.transcribed_chunks.completedByPass;
  options.checkpoint.stages.transcribed_chunks.requiredPasses = preparedPasses.map((pass) => pass.id);
  options.checkpoint.stages.transcribed_chunks.completedByPass = Object.fromEntries(preparedPasses.map((pass) => [pass.id, priorCompleted[pass.id] ?? []]));
  options.checkpoint.stages.transcribed_chunks.total = available.length;
  options.checkpoint.stages.transcribed_chunks.rawChunksDir = prepared.rawChunksDir;
  options.checkpoint.stages.transcribed_chunks.rawTranscriptionDir = prepared.rawTranscriptionDir;
  options.checkpoint.updatedAt = new Date().toISOString();
  options.checkpoint.stages.audio_chunking.status = "complete";
  options.checkpoint.stages.audio_chunking.completedAt = options.checkpoint.updatedAt;
  await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  if (options.stopAfter === "audio-chunking") return { checkpoint: options.checkpoint, selected: [], passes: [] };
  return executePreparedTranscription({ ...options, ...prepared, stages: options.stages });
}
