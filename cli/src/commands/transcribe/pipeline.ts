import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assembleAlignedTranscript,
  assembleTranscript,
  formatChunkTranscript,
} from "./assembly.js";
import {
  alignHybridChunk,
  parseAlignmentResult,
  type AlignmentResult,
} from "./alignment.js";
import {
  measureAudioWindowEnergy,
  normalizeRelativeEnergies,
} from "./audio.js";
import {
  channelMapCompatibilityIssues,
  type ChannelMap,
} from "./channelMap.js";
import {
  parseTranscribeCheckpoint,
  ReconciliationMetadataSchema,
  writeTranscribeCheckpoint,
  type TranscribeCheckpoint,
  type TranscribeCheckpointV3,
  type ReconciliationMetadata,
} from "./checkpoint.js";
import { cleanupOpenAiChunk } from "./openAiStt.js";
import {
  parseChunkSelection,
  chunkAudioPathFor,
  passRawJsonPathFor,
  passRawMarkdownPathFor,
  requiredPasses,
  type TranscriptionPass,
} from "./passes.js";
import { transcribePass, type SttBackendDependencies } from "./sttBackend.js";
import {
  TranscriptionProgressReporter,
  type ProgressWorkUnit,
  type ProgressStage,
} from "./progress.js";
import type { ResolvedTranscriptionProfile } from "./settings.js";
import { parseChunkTranscript, type Manifest } from "./types.js";

let atomicWriteCounter = 0;

export const transcribeStages = [
  "normalization",
  "audio-chunking",
  "transcription",
  "raw-assembly",
  "reconciliation",
  "notes",
] as const;
export type TranscribeStage =
  | (typeof transcribeStages)[number]
  | "correction-review"
  | "correction_review";

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

function legacyReconciliationMetadata(
  outDir: string,
  off = false,
): ReconciliationMetadata {
  const dir = join(outDir, "reconciliation");
  return ReconciliationMetadataSchema.parse({
    provider: off ? "off" : "legacy",
    mode: off ? "off" : "legacy",
    reconciliationDir: dir,
    reconciledTranscriptPath: join(dir, "reconciled_transcript.md"),
    summaryTranscriptPath: join(dir, "summary_transcript.md"),
    reviewQueuePath: join(dir, "reconciliation_review_queue.md"),
    schemaVersion: "legacy.v2",
    promptVersion: "legacy.v2",
    cacheIdentityByChunk: {},
    completedChunkIds: [],
    status: off ? "pending" : "valid",
    summarySafety: { pendingChunkIds: [], bypassChunkIds: [] },
  });
}

function ensureV3Checkpoint(
  checkpoint: TranscribeCheckpoint,
): asserts checkpoint is TranscribeCheckpointV3 {
  const migrated = parseTranscribeCheckpoint(checkpoint);
  if (migrated !== checkpoint) {
    if (!Object.isExtensible(checkpoint))
      throw new Error(
        "Cannot migrate a non-extensible v2 checkpoint in place.",
      );
    for (const key of Object.keys(checkpoint))
      Reflect.deleteProperty(checkpoint, key);
    Object.assign(checkpoint, migrated);
  }
}

export interface SttCacheIdentityInput {
  manifest: Manifest;
  pass: TranscriptionPass;
  target: ResolvedTranscriptionProfile["target"];
  language: string;
  prompt?: string;
}

export function sttCacheIdentity(input: SttCacheIdentityInput): string {
  const target =
    input.target.provider === "openai-compatible"
      ? (() => {
          const url = new URL(input.target.baseUrl);
          return {
            name: input.target.name,
            provider: input.target.provider,
            protocol: input.target.protocol,
            baseUrl: `${url.origin}${url.pathname || "/"}`,
            model: input.target.model,
          };
        })()
      : {
          name: input.target.name,
          provider: input.target.provider,
          model: input.target.model,
        };
  return stable({
    version: 1,
    source: input.manifest.sourceFingerprint,
    audio: {
      source: input.manifest.source,
      audioSettings: input.manifest.audioSettings,
      chunkSettings: input.manifest.chunkSettings,
    },
    pass: input.pass,
    target,
    language: input.language,
    prompt: input.prompt ?? null,
  });
}

export function parseStopAfter(
  value: string | undefined,
): TranscribeStage | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/_/g, "-");
  if (normalized === "correction-review") return "reconciliation";
  if ((transcribeStages as readonly string[]).includes(normalized))
    return normalized as TranscribeStage;
  throw new Error(
    `Unsupported --stop-after stage: ${value}. Expected one of ${transcribeStages.join(", ")}`,
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function atomicText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${++atomicWriteCounter}-${Math.random().toString(36).slice(2)}`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

async function validPair(
  jsonPath: string,
  markdownPath: string,
): Promise<boolean> {
  try {
    parseChunkTranscript(
      JSON.parse(await readFile(jsonPath, "utf8")) as unknown,
    );
    const markdown = await readFile(markdownPath, "utf8");
    return markdown.trim().length > 0;
  } catch {
    return false;
  }
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
  channelMap?: ChannelMap;
  stageReuse?: { audioChunking?: boolean };
}

export interface TranscriptionPipelineOptions
  extends Omit<PreparedPipelineContext, "manifest" | "profile"> {
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
  channelMap?: ChannelMap;
  dependencies?: SttBackendDependencies;
  measureEnergy?: (request: {
    path: string;
    start: number;
    duration: number;
  }) => Promise<number | undefined>;
  onProgress?: (message: string) => void;
  progress?: TranscriptionProgressReporter;
  stages?: {
    normalization?: () => Promise<void>;
    audioChunking?: () => Promise<void>;
    rawAssembly?: () => Promise<void>;
    reconciliation?: () => Promise<{
      status: "valid" | "needs_review" | "invalid" | "skipped";
      metadata: unknown;
    }>;
    /** @deprecated use reconciliation */
    correctionReview?: () => Promise<"complete" | "skipped">;
    notes?: () => Promise<"complete" | "skipped">;
  };
}

export interface TranscriptionPipelineResult {
  checkpoint: TranscribeCheckpoint;
  selected: number[];
  passes: TranscriptionPass[];
}

function transcriptionStatus(
  completed: Record<string, number[]>,
  available: Record<string, number[]>,
): "complete" | "in_progress" {
  return Object.keys(available).every(
    (id) => (completed[id] ?? []).length === (available[id] ?? []).length,
  )
    ? "complete"
    : "in_progress";
}

async function progressOperation<T>(
  reporter: TranscriptionProgressReporter | undefined,
  stage: ProgressStage,
  operation: string,
  task: () => Promise<T>,
  details: {
    chunkIndex?: number;
    chunkCount?: number;
    pass?: string;
    workUnit?: ProgressWorkUnit;
    diagnosticPath?: string;
    reused?: boolean;
  } = {},
): Promise<T> {
  if (!reporter) return task();
  return reporter.operation({ stage, operation, ...details, task });
}

export async function executePreparedTranscription(
  options: TranscriptionPipelineOptions & {
    manifest: Manifest;
    profile: ResolvedTranscriptionProfile;
  },
): Promise<TranscriptionPipelineResult> {
  let activeStage: ProgressStage | undefined;
  try {
    ensureV3Checkpoint(options.checkpoint);
  if (
    options.stopAfter === "correction-review" ||
    options.stopAfter === "correction_review"
  )
    options.stopAfter = "reconciliation";
  if (options.profile.layout === "hybrid" && !options.channelMap) {
    throw new Error(
      "Hybrid transcription requires a valid session channel map.",
    );
  }
  if (options.profile.layout === "hybrid") {
    const issues = channelMapCompatibilityIssues(options.channelMap!, {
      source: options.manifest.source,
      channels: options.manifest.preparedChannels.map(({ id, index }) => ({
        id,
        index,
      })),
    });
    if (issues.length > 0)
      throw new Error(
        `Hybrid channel map is incompatible: ${issues.join("; ")}`,
      );
  }
  const passes = requiredPasses(
    options.profile.layout,
    options.manifest.preparedChannels,
  );
  const prompt = options.prompt ?? options.profile.prompt;
  options.checkpoint.profile = options.profile.name;
  options.checkpoint.layout = options.profile.layout;
  const available = options.manifest.chunks.map((chunk) => chunk.index);
  const selected = parseChunkSelection(options.selection, available);
  const stage = options.checkpoint.stages.transcribed_chunks;
  const availableByPass = Object.fromEntries(
    passes.map((pass) => [pass.id, available]),
  );
  const identityByPass = Object.fromEntries(
    passes.map((pass) => [
      pass.id,
      sttCacheIdentity({
        manifest: options.manifest,
        pass,
        target: options.profile.target,
        language: options.language,
        prompt,
      }),
    ]),
  );
  const previousIdentity =
    (stage as typeof stage & { cacheIdentityByPass?: Record<string, string> })
      .cacheIdentityByPass ?? {};
  const identityChanged =
    passes.some(
      (pass) => previousIdentity[pass.id] !== identityByPass[pass.id],
    ) ||
    JSON.stringify(Object.keys(previousIdentity).sort()) !==
      JSON.stringify(passes.map((pass) => pass.id).sort());
  const retained = stage.completedByPass;
  const completedByPass: Record<string, number[]> = Object.fromEntries(
    passes.map((pass) => [pass.id, []]),
  );
  for (const pass of passes) {
    if (previousIdentity[pass.id] !== identityByPass[pass.id]) continue;
    for (const index of retained[pass.id] ?? []) {
      if (
        await validPair(
          passRawJsonPathFor(options.rawChunksDir, pass, index),
          passRawMarkdownPathFor(options.rawTranscriptionDir, pass, index),
        )
      )
        completedByPass[pass.id]!.push(index);
    }
  }
  const completionChanged = passes.some(
    (pass) =>
      JSON.stringify(retained[pass.id] ?? []) !==
      JSON.stringify(completedByPass[pass.id] ?? []),
  );
  stage.requiredPasses = passes.map((pass) => pass.id);
  stage.completedByPass = completedByPass;
  stage.selection = selected;
  stage.total = options.manifest.chunks.length;
  stage.rawChunksDir = options.rawChunksDir;
  stage.rawTranscriptionDir = options.rawTranscriptionDir;
  (
    stage as typeof stage & { cacheIdentityByPass?: Record<string, string> }
  ).cacheIdentityByPass = identityByPass;
  options.checkpoint.stages.audio_chunking.requiredPasses = passes.map(
    (pass) => pass.id,
  );
  options.checkpoint.stages.audio_chunking.availableByPass = availableByPass;
  options.checkpoint.stages.transcribed_chunks.status = transcriptionStatus(
    completedByPass,
    availableByPass,
  );
  let downstreamInvalidated = identityChanged || completionChanged;
  const invalidateDownstream = (): void => {
    downstreamInvalidated = true;
    options.checkpoint.stages.joining_raw_transcription.status = "pending";
    options.checkpoint.stages.joining_raw_transcription.completedAt = undefined;
    options.checkpoint.stages.reconciliation.status = "pending";
    options.checkpoint.stages.reconciliation.completedAt = undefined;
    options.checkpoint.stages.notes_summary_pass.status = "pending";
    options.checkpoint.stages.notes_summary_pass.completedAt = undefined;
    options.checkpoint.stages.done.status = "pending";
    options.checkpoint.stages.done.completedAt = undefined;
  };
  if (downstreamInvalidated) invalidateDownstream();
  options.checkpoint.updatedAt = new Date().toISOString();
  await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);

  if (options.stopAfter === "audio-chunking")
    return { checkpoint: options.checkpoint, selected, passes };

  activeStage = "transcription";
  let transcriptionHadNewWork = false;
  for (const pass of passes) {
    for (const index of selected) {
      if (completedByPass[pass.id]!.includes(index) && !options.force) {
        await options.progress?.event({
          stage: "transcription",
          operation: "ASR",
          status: "reused",
          chunkIndex: index,
          chunkCount: available.length,
          pass: pass.id,
          workUnit: {
            label: "left",
            index: available.indexOf(index),
            total: available.length,
          },
          diagnosticPath: options.rawChunksDir,
        });
        continue;
      }
      if (!downstreamInvalidated) invalidateDownstream();
      transcriptionHadNewWork = true;
      const chunk = options.manifest.chunks.find(
        (candidate) => candidate.index === index,
      )!;
      options.onProgress?.(`Transcribing ${pass.id} chunk ${index}\n`);
      const [transcript] = await progressOperation(
        options.progress,
        "transcription",
        "ASR",
        () =>
          transcribePass(
            {
              target: options.profile.target,
              pass,
              chunks: [
                {
                  index,
                  path: chunkAudioPathFor(options.chunksDir, pass, index),
                },
              ],
              outDir: options.rawChunksDir,
              language: options.language,
              prompt,
              force: Boolean(options.force),
              onProgress: options.onProgress,
            },
            options.dependencies,
          ),
        {
          chunkIndex: index,
          chunkCount: available.length,
          pass: pass.id,
          workUnit: {
            label: "left",
            index: available.indexOf(index),
            total: available.length,
          },
          diagnosticPath: options.rawChunksDir,
        },
      );
      if (!transcript)
        throw new Error(
          `STT returned an invalid transcript for ${pass.id} chunk ${index}`,
        );
      const parsedTranscript = parseChunkTranscript(transcript);
      const rawJsonPath = passRawJsonPathFor(options.rawChunksDir, pass, index);
      await atomicText(
        rawJsonPath,
        `${JSON.stringify(parsedTranscript, null, 2)}\n`,
      );
      options.onProgress?.(
        `Saved raw JSON for ${pass.id} chunk ${index}: ${rawJsonPath}\n`,
      );
      const markdown = formatChunkTranscript({
        ...chunk,
        transcript: parsedTranscript,
      });
      if (!markdown.trim())
        throw new Error(
          `STT produced no renderable markdown for ${pass.id} chunk ${index}`,
        );
      const rawMarkdownPath = passRawMarkdownPathFor(
        options.rawTranscriptionDir,
        pass,
        index,
      );
      await atomicText(rawMarkdownPath, markdown);
      options.onProgress?.(
        `Saved raw Markdown for ${pass.id} chunk ${index}: ${rawMarkdownPath}\n`,
      );
      completedByPass[pass.id] = [
        ...new Set([...completedByPass[pass.id]!, index]),
      ].sort((a, b) => a - b);
      stage.completedByPass = completedByPass;
      options.checkpoint.updatedAt = new Date().toISOString();
      await writeTranscribeCheckpoint(
        options.checkpointPath,
        options.checkpoint,
      );
      options.onProgress?.(
        `Checkpoint advanced through ${pass.id} chunk ${index}\n`,
      );
      try {
        await cleanupOpenAiChunk(transcript);
        options.onProgress?.(
          `Remote cleanup completed for ${pass.id} chunk ${index}\n`,
        );
      } catch {
        options.onProgress?.(
          `Remote cleanup deferred to the server TTL for ${pass.id} chunk ${index}\n`,
        );
      }
    }
  }
  const transcriptionComplete = passes.every(
    (pass) => completedByPass[pass.id]!.length === available.length,
  );
  stage.status = transcriptionComplete ? "complete" : "in_progress";
  options.checkpoint.updatedAt = new Date().toISOString();
  stage.completedAt = transcriptionComplete
    ? options.checkpoint.updatedAt
    : undefined;
  await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  if (!transcriptionComplete) {
    if (options.stopAfter === "transcription")
      return { checkpoint: options.checkpoint, selected, passes };
    return { checkpoint: options.checkpoint, selected, passes };
  }
  options.progress?.completeStage(
    "transcription",
    transcriptionHadNewWork ? "complete" : "reused",
  );
  activeStage = undefined;

  activeStage = "raw-assembly";
  let rawAssemblyHadNewWork = false;
  const alignmentDir = join(options.rawTranscriptionDir, "alignment");
  const alignmentIdentity = stable({
    version: 1,
    channelMap: options.channelMap ?? null,
    passes: identityByPass,
  });
  const joining = options.checkpoint.stages.joining_raw_transcription;
  const alignmentPaths = options.manifest.chunks.map((chunk) =>
    join(alignmentDir, `session_${String(chunk.index).padStart(3, "0")}.json`),
  );
  const cachedAlignments: AlignmentResult[] = [];
  let alignmentReusable =
    options.profile.layout === "hybrid" &&
    joining.alignmentIdentity === alignmentIdentity &&
    joining.alignmentDir === alignmentDir;
  if (alignmentReusable) {
    try {
      for (const path of alignmentPaths)
        cachedAlignments.push(
          parseAlignmentResult(
            JSON.parse(await readFile(path, "utf8")) as unknown,
          ),
        );
      if (!joining.path) throw new Error("Missing raw transcript path");
      const rawTranscript = await readFile(joining.path, "utf8");
      if (options.stages?.rawAssembly) {
        if (!rawTranscript.trim()) throw new Error("Empty raw transcript");
      } else {
        const expected = assembleAlignedTranscript({
          source: options.source,
          backend: options.backend,
          model: options.model ?? options.profile.target.model,
          chunks: cachedAlignments,
        });
        if (rawTranscript !== expected)
          throw new Error("Raw transcript does not match cached alignment");
      }
    } catch {
      alignmentReusable = false;
    }
  }
  if (options.profile.layout === "hybrid" && !alignmentReusable) {
    rawAssemblyHadNewWork = true;
    invalidateDownstream();
    const stereo = passes.find((pass) => pass.kind === "stereo")!;
    const channelPasses = passes.filter(
      (pass): pass is Extract<TranscriptionPass, { kind: "channel" }> =>
        pass.kind === "channel",
    );
    const alignments: AlignmentResult[] = [];
    for (const chunk of options.manifest.chunks) {
      const stereoTranscript = parseChunkTranscript(
        JSON.parse(
          await readFile(
            passRawJsonPathFor(options.rawChunksDir, stereo, chunk.index),
            "utf8",
          ),
        ) as unknown,
      );
      const channels = await Promise.all(
        channelPasses.map(async (pass, passIndex) => {
          const transcript = parseChunkTranscript(
            JSON.parse(
              await readFile(
                passRawJsonPathFor(options.rawChunksDir, pass, chunk.index),
                "utf8",
              ),
            ) as unknown,
          );
          const energies = await Promise.all(
            transcript.segments.map(async (segment) => {
              const windowEnergies = await Promise.all(
                channelPasses.map((candidatePass) =>
                  (
                    options.measureEnergy ??
                    ((request) =>
                      measureAudioWindowEnergy(
                        request.path,
                        request.start,
                        request.duration,
                      ))
                  )({
                    path: chunkAudioPathFor(
                      options.chunksDir,
                      candidatePass,
                      chunk.index,
                    ),
                    start: segment.start,
                    duration: segment.end - segment.start,
                  }),
                ),
              );
              return normalizeRelativeEnergies(windowEnergies)[passIndex];
            }),
          );
          return {
            passId: pass.id,
            channelId: pass.id,
            segments: transcript.segments,
            segmentEnergies: energies,
          };
        }),
      );
      const result = alignHybridChunk({
        chunkStart: chunk.overlapStart,
        logicalStart: chunk.start,
        logicalEnd: chunk.end,
        stereo: stereoTranscript.segments,
        channels,
        channelMap: options.channelMap,
      });
      alignments.push(result);
      await atomicText(
        join(
          alignmentDir,
          `session_${String(chunk.index).padStart(3, "0")}.json`,
        ),
        `${JSON.stringify(parseAlignmentResult(result), null, 2)}\n`,
      );
    }
    joining.alignmentDir = alignmentDir;
    joining.alignmentIdentity = alignmentIdentity;
    if (options.stages?.rawAssembly)
      await progressOperation(
        options.progress,
        "raw-assembly",
        "Assemble raw transcript",
        options.stages.rawAssembly,
        { diagnosticPath: joining.path },
      );
    else
      await atomicText(
        joining.path!,
        assembleAlignedTranscript({
          source: options.source,
          backend: options.backend,
          model: options.model ?? options.profile.target.model,
          chunks: alignments,
        }),
      );
  } else if (
    options.profile.layout === "hybrid" &&
    joining.status !== "complete"
  ) {
    rawAssemblyHadNewWork = true;
    if (options.stages?.rawAssembly)
      await progressOperation(
        options.progress,
        "raw-assembly",
        "Assemble raw transcript",
        options.stages.rawAssembly,
        { diagnosticPath: joining.path },
      );
    else
      await atomicText(
        joining.path!,
        assembleAlignedTranscript({
          source: options.source,
          backend: options.backend,
          model: options.model ?? options.profile.target.model,
          chunks: cachedAlignments,
        }),
      );
  }
  if (options.profile.layout === "hybrid") {
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.joining_raw_transcription = {
      ...joining,
      status: "complete",
      completedAt: options.checkpoint.updatedAt,
      path: joining.path,
      alignmentDir,
      alignmentIdentity,
    };
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  }
  if (options.profile.layout !== "hybrid" && joining.status !== "complete") {
    rawAssemblyHadNewWork = true;
    const stereo = passes.find((pass) => pass.kind === "stereo")!;
    const transcripts = await Promise.all(
      options.manifest.chunks.map(async (chunk) => ({
        ...chunk,
        transcript: parseChunkTranscript(
          JSON.parse(
            await readFile(
              passRawJsonPathFor(options.rawChunksDir, stereo, chunk.index),
              "utf8",
            ),
          ) as unknown,
        ),
      })),
    );
    if (options.stages?.rawAssembly)
      await progressOperation(
        options.progress,
        "raw-assembly",
        "Assemble raw transcript",
        options.stages.rawAssembly,
        {
          diagnosticPath:
            options.checkpoint.stages.joining_raw_transcription.path,
        },
      );
    else
      await atomicText(
        options.checkpoint.stages.joining_raw_transcription.path!,
        assembleTranscript({
          source: options.source,
          backend: options.backend,
          model: options.model ?? options.profile.target.model,
          chunks: transcripts,
          silences: options.manifest.silences,
          silenceTagMinimumSeconds: options.silenceTagMinimumSeconds,
        }),
      );
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.joining_raw_transcription = {
      status: "complete",
      completedAt: options.checkpoint.updatedAt,
      path: options.checkpoint.stages.joining_raw_transcription.path,
    };
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  }
  options.progress?.completeStage(
    "raw-assembly",
    rawAssemblyHadNewWork ? "complete" : "reused",
  );
  activeStage = undefined;
  if (options.stopAfter === "raw-assembly")
    return { checkpoint: options.checkpoint, selected, passes };
  activeStage = "reconciliation";
  let reconciliationHadNewWork = false;
  if (options.checkpoint.stages.reconciliation.status === "pending") {
    let result = options.stages?.reconciliation
      ? await progressOperation(
          options.progress,
          "reconciliation",
          "Reconcile transcript",
          options.stages.reconciliation,
          {
            diagnosticPath:
              options.checkpoint.stages.reconciliation.metadata
                .reconciliationDir,
          },
        )
      : undefined;
    if (!result && options.stages?.correctionReview) {
      const legacyStatus = await options.stages.correctionReview();
      result = {
        status:
          legacyStatus === "complete"
            ? ("valid" as const)
            : ("skipped" as const),
        metadata: legacyReconciliationMetadata(
          options.checkpoint.outDir,
          legacyStatus === "skipped",
        ),
      };
    }
    if (!result)
      throw new Error(
        "Missing required stages.reconciliation hook for reconciliation stage.",
      );
    reconciliationHadNewWork = result.status !== "skipped";
    const metadata = ReconciliationMetadataSchema.parse(result.metadata);
    if (result.status === "skipped") {
      if (
        metadata.status !== "pending" ||
        !["off", "legacy"].includes(metadata.mode)
      )
        throw new Error(
          "Skipped reconciliation requires pending off/legacy metadata.",
        );
    } else if (metadata.status !== result.status) {
      throw new Error(
        "Reconciliation result status disagrees with metadata status.",
      );
    }
    const previousMetadata = stable(
      options.checkpoint.stages.reconciliation.metadata,
    );
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.reconciliation.metadata = metadata;
    if (result.status === "invalid") {
      options.checkpoint.stages.reconciliation.status = "failed";
      options.checkpoint.stages.reconciliation.error =
        "Canonical reconciliation validation failed.";
      options.checkpoint.stages.reconciliation.completedAt = undefined;
    } else {
      options.checkpoint.stages.reconciliation.status =
        result.status === "skipped" ? "skipped" : "complete";
      options.checkpoint.stages.reconciliation.error = undefined;
      options.checkpoint.stages.reconciliation.completedAt =
        options.checkpoint.updatedAt;
    }
    if (
      previousMetadata !==
      stable(options.checkpoint.stages.reconciliation.metadata)
    ) {
      options.checkpoint.stages.notes_summary_pass.status = "pending";
      options.checkpoint.stages.notes_summary_pass.completedAt = undefined;
      options.checkpoint.stages.done.status = "pending";
      options.checkpoint.stages.done.completedAt = undefined;
    }
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
    if (result.status === "invalid")
      throw new Error("Reconciliation failed; notes were not run.");
  }
  if (options.checkpoint.stages.reconciliation.status === "failed") {
    options.progress?.completeStage("reconciliation", "failed", {
      error:
        options.checkpoint.stages.reconciliation.error ??
        "Reconciliation failed",
    });
    activeStage = undefined;
    throw new Error(
      options.checkpoint.stages.reconciliation.error ??
        "Reconciliation failed; notes were not run.",
    );
  }
  options.progress?.completeStage(
    "reconciliation",
    options.checkpoint.stages.reconciliation.status === "skipped"
      ? "skipped"
      : options.checkpoint.stages.reconciliation.status === "complete"
        ? reconciliationHadNewWork
          ? "complete"
          : "reused"
        : "failed",
  );
  activeStage = undefined;
  if (options.stopAfter === "reconciliation")
    return { checkpoint: options.checkpoint, selected, passes };
  activeStage = "notes";
  let notesHadNewWork = false;
  if (options.checkpoint.stages.notes_summary_pass.status === "pending") {
    if (!options.stages?.notes) {
      throw new Error(
        "Missing required stages.notes hook for stereo notes stage.",
      );
    }
    const notesStatus = await progressOperation(
      options.progress,
      "notes",
      "Generate session summary",
      options.stages.notes,
      {
        diagnosticPath: options.checkpoint.stages.notes_summary_pass.notesPath,
      },
    );
    notesHadNewWork = notesStatus !== "skipped";
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.notes_summary_pass.status = notesStatus;
    options.checkpoint.stages.notes_summary_pass.completedAt =
      options.checkpoint.updatedAt;
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  }
  if (options.checkpoint.stages.notes_summary_pass.status === "failed") {
    options.progress?.completeStage("notes", "failed", {
      error: "Notes stage failed",
    });
    activeStage = undefined;
    throw new Error("Notes stage failed");
  }
  options.progress?.completeStage(
    "notes",
    options.checkpoint.stages.notes_summary_pass.status === "skipped"
      ? "skipped"
      : options.checkpoint.stages.notes_summary_pass.status === "complete"
        ? notesHadNewWork
          ? "complete"
          : "reused"
        : "failed",
  );
  activeStage = undefined;
  if (options.stopAfter === "notes")
    return { checkpoint: options.checkpoint, selected, passes };
  if (options.checkpoint.stages.done.status !== "complete") {
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.done.status = "complete";
    options.checkpoint.stages.done.completedAt = options.checkpoint.updatedAt;
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
  }
  return { checkpoint: options.checkpoint, selected, passes };
  } catch (error) {
    if (activeStage) {
      options.progress?.completeStage(activeStage, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export interface TranscriptionLifecycleOptions
  extends Omit<
    TranscriptionPipelineOptions,
    "manifest" | "profile" | "stageReuse"
  > {
  normalize: () => Promise<void>;
  prepareAudio: () => Promise<PreparedPipelineContext>;
  stageReuse?: { normalization?: boolean; audioChunking?: boolean };
}

/** Owns the complete normalize → prepare → transcribe → downstream lifecycle. */
export async function executeTranscriptionPipeline(
  options: TranscriptionLifecycleOptions,
): Promise<TranscriptionPipelineResult> {
  let activeStage: ProgressStage | undefined;
  try {
    ensureV3Checkpoint(options.checkpoint);
    const normalizationWasComplete =
      options.checkpoint.stages.normalization.status === "complete";
    activeStage = "normalization";
    await progressOperation(
      options.progress,
      "normalization",
      "Prepare normalized audio",
      options.normalize,
      { diagnosticPath: options.checkpoint.stages.normalization.path },
    );
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.normalization.status = "complete";
    options.checkpoint.stages.normalization.completedAt =
      options.checkpoint.updatedAt;
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
    options.progress?.completeStage(
      "normalization",
      normalizationWasComplete || options.stageReuse?.normalization
        ? "reused"
        : "complete",
    );
    activeStage = undefined;
    if (options.stopAfter === "normalization")
      return { checkpoint: options.checkpoint, selected: [], passes: [] };

    const audioChunkingWasComplete =
      options.checkpoint.stages.audio_chunking.status === "complete";
    activeStage = "audio-chunking";
    const prepared = await progressOperation(
      options.progress,
      "audio-chunking",
      "Prepare audio chunks",
      options.prepareAudio,
      { diagnosticPath: options.checkpoint.stages.audio_chunking.dir },
    );
    const preparedPasses = requiredPasses(
      prepared.profile.layout,
      prepared.manifest.preparedChannels,
    );
    const available = prepared.manifest.chunks.map((chunk) => chunk.index);
    options.checkpoint.profile = prepared.profile.name;
    options.checkpoint.layout = prepared.profile.layout;
    options.checkpoint.stages.audio_chunking.count = available.length;
    options.checkpoint.stages.audio_chunking.dir = prepared.chunksDir;
    options.checkpoint.stages.audio_chunking.requiredPasses =
      preparedPasses.map((pass) => pass.id);
    options.checkpoint.stages.audio_chunking.availableByPass =
      Object.fromEntries(preparedPasses.map((pass) => [pass.id, available]));
    const priorCompleted =
      options.checkpoint.stages.transcribed_chunks.completedByPass;
    options.checkpoint.stages.transcribed_chunks.requiredPasses =
      preparedPasses.map((pass) => pass.id);
    options.checkpoint.stages.transcribed_chunks.completedByPass =
      Object.fromEntries(
        preparedPasses.map((pass) => [pass.id, priorCompleted[pass.id] ?? []]),
      );
    options.checkpoint.stages.transcribed_chunks.total = available.length;
    options.checkpoint.stages.transcribed_chunks.rawChunksDir =
      prepared.rawChunksDir;
    options.checkpoint.stages.transcribed_chunks.rawTranscriptionDir =
      prepared.rawTranscriptionDir;
    options.checkpoint.updatedAt = new Date().toISOString();
    options.checkpoint.stages.audio_chunking.status = "complete";
    options.checkpoint.stages.audio_chunking.completedAt =
      options.checkpoint.updatedAt;
    await writeTranscribeCheckpoint(options.checkpointPath, options.checkpoint);
    options.progress?.completeStage(
      "audio-chunking",
      audioChunkingWasComplete ||
        options.stageReuse?.audioChunking ||
        prepared.stageReuse?.audioChunking
        ? "reused"
        : "complete",
    );
    activeStage = undefined;
    if (options.stopAfter === "audio-chunking")
      return { checkpoint: options.checkpoint, selected: [], passes: [] };
    return await executePreparedTranscription({
      ...options,
      ...prepared,
      stages: options.stages,
    });
  } catch (error) {
    if (activeStage) {
      options.progress?.completeStage(activeStage, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    await options.progress?.close();
  }
}
