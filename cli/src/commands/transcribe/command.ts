import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildCommand,
  buildRouteMap,
  type FlagParametersForType,
} from "@stricli/core";

import { getTranscribeConfig } from "@/config.js";
import type { LocalContext } from "@/context.js";
import { applyCorrectionsCommand } from "./applyCorrections.js";
import { archiveCommand } from "./archive/command.js";

import {
  deriveMonoChannels,
  getAudioDurationSeconds,
  normalizeToFlac,
  probeAudio,
  channelId,
  writeChunkFlacs,
} from "./audio.js";
import {
  getCheckpointPath,
  readTranscribeCheckpoint,
  type TranscribeCheckpoint,
} from "./checkpoint.js";
import { channelsCommand } from "./channels/command.js";
import { planChunks } from "./chunkPlanner.js";
import {
  correctedTranscriptionDirFor,
  correctionNotesChunksDirFor,
  runCodexCorrection,
  runCodexNotes,
  runCodexSummaryCleanup,
  summaryTranscriptionDirFor,
} from "./codex.js";
import {
  buildContextExcerpt,
  collectContextFiles,
  writeGlossary,
} from "./context.js";
import {
  loadCorrectionRulesMarkdown,
  writeCorrectionRulesContext,
} from "./corrections.js";
import { transcribeChunksWithLocalWhisper } from "./localWhisper.js";
import { transcribeChunksWithNodeWhisper } from "./nodeWhisper.js";
import { getNotesPath } from "./notes.js";
import { runOllamaHierarchicalNotes } from "./ollamaNotes.js";
import { runHermesTranscriptReview } from "./hermesReview.js";
import { resolveTranscriptionProfile } from "./settings.js";
import { parseChunkSelection, requiredPasses, chunkAudioPathFor } from "./passes.js";
import { executeTranscriptionPipeline, parseStopAfter, transcribeStages, type TranscribeStage } from "./pipeline.js";
import {
  resolveFromCwd,
  resolveTranscribeSessionPaths,
} from "./sessionPaths.js";
import {
  parseReviewProvider,
  resolveReviewSettings,
  type ReviewProvider,
} from "./reviewSettings.js";
import {
  canReusePassAudioChunks,
  canReuseDependentAudio,
  manifestCompatibilityIssues,
  readManifest,
  shouldOverwritePreparedAudio,
  shouldOverwritePreparedChannels,
} from "./resume.js";
import { detectSilences, trimChunksToSpeech } from "./silence.js";
import {
  defaultSttBackend,
  parseSttBackend,
  type SttBackend,
} from "./sttBackend.js";
import type { ChunkTranscript, Manifest } from "./types.js";

type NotesBackend = "codex" | "ollama";

interface TranscribeFlags {
  campaign: string;
  "session-date": string;
  out?: string;
  corrections?: string;
  "context-root": string;
  "whisper-model": string;
  language: string;
  backend: SttBackend;
  profile?: string;
  "node-whisper-model-root"?: string;
  "auto-download-model"?: boolean;
  "chunk-seconds": number;
  "boundary-search-seconds": number;
  "boundary-max-search-seconds": number;
  "overlap-seconds": number;
  denoise?: boolean;
  "voice-boost"?: boolean;
  "keep-silence"?: boolean;
  "silence-padding-seconds": number;
  "minimum-speech-seconds": number;
  "silence-tag-seconds": number;
  device: string;
  "compute-type": string;
  python: string;
  force?: boolean;
  resume?: boolean;
  "skip-correction"?: boolean;
  "skip-summary-cleanup"?: boolean;
  "skip-notes"?: boolean;
  review?: ReviewProvider;
  "hermes-profile"?: string;
  "hermes-max-turns": number;
  "notes-backend": NotesBackend;
  "notes-model": string;
  "ollama-url": string;
  "summary-chunk-chars": number;
  "summary-scene-size": number;
  chunks?: string;
  "stop-after"?: string;
}

const parseNumber = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative number, received ${value}`);
  }
  return parsed;
};

const parsePositiveInteger = (value: string): number => {
  const parsed = parseNumber(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
};

const parseNotesBackend = (value: string): NotesBackend => {
  if (value === "codex" || value === "ollama") {
    return value;
  }
  throw new Error(`Unsupported notes backend: ${value}`);
};

const flags: FlagParametersForType<TranscribeFlags, LocalContext> = {
  campaign: {
    kind: "parsed",
    parse: String,
    brief: "Campaign slug, e.g. the-vengeful",
  },
  "session-date": {
    kind: "parsed",
    parse: String,
    brief: "Session date for the generated note filename, YYYY-MM-DD",
  },
  out: {
    kind: "parsed",
    parse: String,
    brief: "Output directory for generated audio/transcript artifacts",
    optional: true,
  },
  corrections: {
    kind: "parsed",
    parse: String,
    brief: "Path to shared transcription correction rules YAML",
    optional: true,
  },
  "context-root": {
    kind: "parsed",
    parse: String,
    brief: "Astro docs content root used for correction context",
    default: "astro/src/content/docs",
  },
  "whisper-model": {
    kind: "parsed",
    parse: String,
    brief: "Whisper model name used by the selected STT backend",
    default: "large-v3-turbo",
  },
  language: {
    kind: "parsed",
    parse: String,
    brief:
      "Whisper language code, e.g. en or tl; use auto for language autodetection",
    default: "en",
  },
  backend: {
    kind: "parsed",
    parse: parseSttBackend,
    brief: "STT backend: nodejs-whisper or faster-whisper",
    default: defaultSttBackend,
  },
  profile: {
    kind: "parsed",
    parse: String,
    brief: "Named transcription profile from transcribe.profiles",
    optional: true,
  },
  "node-whisper-model-root": {
    kind: "parsed",
    parse: String,
    brief: "Directory containing nodejs-whisper ggml model files",
    optional: true,
  },
  "auto-download-model": {
    kind: "boolean",
    brief: "Allow nodejs-whisper to download the selected model if missing",
    optional: true,
  },
  "chunk-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief: "Target chunk size in seconds",
    default: "600",
  },
  "boundary-search-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief: "Preferred silence boundary search window in seconds",
    default: "10",
  },
  "boundary-max-search-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief: "Maximum silence boundary search window in seconds",
    default: "30",
  },
  "overlap-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief: "Overlap on both sides of each chunk in seconds",
    default: "5",
  },
  denoise: {
    kind: "boolean",
    brief:
      "Apply conservative ffmpeg noise reduction before speech normalization",
    optional: true,
  },
  "voice-boost": {
    kind: "boolean",
    brief:
      "Apply a mild speech-presence EQ boost before loudness normalization",
    optional: true,
  },
  "keep-silence": {
    kind: "boolean",
    brief:
      "Keep long leading/trailing silence in chunks instead of trimming it before transcription",
    optional: true,
  },
  "silence-padding-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief:
      "Seconds of context to keep around detected speech when trimming silent chunk edges",
    default: "1",
  },
  "minimum-speech-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief:
      "Drop planned chunks with less speech than this after silence trimming",
    default: "2",
  },
  "silence-tag-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief: "Minimum silence duration to tag in the assembled raw transcript",
    default: "10",
  },
  device: {
    kind: "parsed",
    parse: String,
    brief: "faster-whisper device",
    default: "auto",
  },
  "compute-type": {
    kind: "parsed",
    parse: String,
    brief: "faster-whisper compute type; ignored by nodejs-whisper",
    default: "int8_float16",
  },
  python: {
    kind: "parsed",
    parse: String,
    brief:
      "Python executable with faster-whisper installed; ignored by nodejs-whisper",
    default: "python3",
  },
  force: {
    kind: "boolean",
    brief: "Overwrite generated outputs",
    optional: true,
  },
  resume: {
    kind: "boolean",
    brief: "Resume from existing transcript workflow artifacts when possible",
    optional: true,
  },
  "skip-correction": {
    kind: "boolean",
    brief: "Skip Codex transcript correction",
    optional: true,
  },
  "skip-summary-cleanup": {
    kind: "boolean",
    brief:
      "Skip the Codex transcript cleanup pass used to prepare safer note summaries",
    optional: true,
  },
  "skip-notes": {
    kind: "boolean",
    brief: "Skip Astro campaign note generation",
    optional: true,
  },
  review: {
    kind: "parsed",
    parse: parseReviewProvider,
    brief: "Transcript review provider: hermes or off; overrides project config",
    optional: true,
  },
  "hermes-profile": {
    kind: "parsed",
    parse: String,
    brief: "Hermes profile used by the transcript review provider",
    optional: true,
  },
  "hermes-max-turns": {
    kind: "parsed",
    parse: parsePositiveInteger,
    brief: "Maximum Hermes tool iterations for each reviewed transcript chunk",
    default: "12",
  },
  "notes-backend": {
    kind: "parsed",
    parse: parseNotesBackend,
    brief: "Notes generation backend: codex or ollama",
    default: "codex",
  },
  "notes-model": {
    kind: "parsed",
    parse: String,
    brief: "Model used by the selected notes backend",
    default: "qwen3:8b",
  },
  "ollama-url": {
    kind: "parsed",
    parse: String,
    brief: "Ollama server URL for --notes-backend ollama",
    default: "http://127.0.0.1:11434",
  },
  "summary-chunk-chars": {
    kind: "parsed",
    parse: parsePositiveInteger,
    brief: "Character budget for each local-model transcript summary chunk",
    default: "12000",
  },
  "summary-scene-size": {
    kind: "parsed",
    parse: parsePositiveInteger,
    brief: "Number of chunk summaries to merge into each scene summary",
    default: "5",
  },
  chunks: {
    kind: "parsed",
    parse: String,
    brief: "Bounded chunk indexes or ranges, e.g. 0,4-7",
    optional: true,
  },
  "stop-after": {
    kind: "parsed",
    parse: (value: string) => parseStopAfter(value)!,
    brief: `Stop after a stage: ${transcribeStages.join(", ")}`,
    optional: true,
  },
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertSessionDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("--session-date must use YYYY-MM-DD");
  }
}


function baseCheckpoint(options: {
  source: string;
  outDir: string;
  campaign: string;
  sessionDate: string;
  normalizedPath: string;
  chunksDir: string;
  rawChunksDir: string;
  rawTranscriptionDir: string;
  rawTranscriptPath: string;
  correctedTranscriptPath: string;
  correctionNotesPath: string;
  notesPath: string;
  chunkCount?: number;
  profile: string;
  layout: "stereo" | "hybrid";
  requiredPassIds: string[];
  availableByPass: Record<string, number[]>;
  selection: number[];
}): TranscribeCheckpoint {
  const now = new Date().toISOString();
  return {
    version: 2,
    updatedAt: now,
    source: options.source,
    outDir: options.outDir,
    sessionDate: options.sessionDate,
    campaign: options.campaign,
    profile: options.profile,
    layout: options.layout,
    stages: {
      normalization: {
        status: "pending",
        path: options.normalizedPath,
      },
      audio_chunking: {
        status: "pending",
        count: options.chunkCount,
        dir: options.chunksDir,
        requiredPasses: options.requiredPassIds,
        availableByPass: options.availableByPass,
      },
      transcribed_chunks: {
        status: "pending",
        requiredPasses: options.requiredPassIds,
        completedByPass: Object.fromEntries(options.requiredPassIds.map((id) => [id, []])),
        selection: options.selection,
        total: options.chunkCount,
        rawChunksDir: options.rawChunksDir,
        rawTranscriptionDir: options.rawTranscriptionDir,
      },
      joining_raw_transcription: {
        status: "pending",
        path: options.rawTranscriptPath,
      },
      correction_pass: {
        status: "pending",
        correctedTranscriptPath: options.correctedTranscriptPath,
        correctionNotesPath: options.correctionNotesPath,
      },
      notes_summary_pass: {
        status: "pending",
        notesPath: options.notesPath,
      },
      done: {
        status: "pending",
      },
    },
  };
}


function buildTranscribeRunCommand(forcedStopAfter?: TranscribeStage, brief = "Normalize, chunk, transcribe, correct, and summarize campaign audio") {
  return buildCommand({
  async func(this: LocalContext, flags: TranscribeFlags, audioFile: string) {
    assertSessionDate(flags["session-date"]);

    const cwd = this.currentPath;
    const { audioPath, outDir } = resolveTranscribeSessionPaths({
      cwd,
      audioFile,
      out: flags.out,
    });
    const contextRoot = resolveFromCwd(cwd, flags["context-root"]);
    const correctionsPath = flags.corrections
      ? resolveFromCwd(cwd, flags.corrections)
      : undefined;
    const normalizedPath = join(outDir, "normalized", "session.flac");
    const channelsDir = join(outDir, "normalized", "channels");
    const chunksDir = join(outDir, "chunks");
    const rawChunksDir = join(outDir, "raw_chunks");
    const rawTranscriptionDir = join(outDir, "raw_transcription");
    const manifestPath = join(outDir, "manifest.json");
    const checkpointPath = getCheckpointPath(outDir);
    const rawTranscriptPath = join(outDir, "raw_transcript.md");
    const correctedTranscriptPath = join(outDir, "corrected_transcript.md");
    const reconciledTranscriptPath = join(outDir, "reconciled_transcript.md");
    const summaryTranscriptPath = join(outDir, "summary_transcript.md");
    const correctionNotesPath = join(outDir, "correction_notes.md");
    const hermesReviewNotesPath = join(outDir, "hermes_review_notes.md");
    const transcribeConfig = getTranscribeConfig();
    const resolvedProfile = resolveTranscriptionProfile(transcribeConfig, flags.profile);
    const effectiveProfile = resolvedProfile.name === "legacy-local"
      ? { ...resolvedProfile, target: { ...resolvedProfile.target, provider: flags.backend, model: flags["whisper-model"] } }
      : resolvedProfile;
    const reviewSettings = resolveReviewSettings(
      transcribeConfig["review"],
      {
        provider: flags.review,
        hermesProfile: flags["hermes-profile"],
        hermesMaxTurns: flags["hermes-max-turns"],
      },
    );
    const notesPath = getNotesPath({
      contextRoot,
      campaign: flags.campaign,
      sessionDate: flags["session-date"],
    });
    const shouldResume = Boolean(flags.resume) && !flags.force;

    const sourceProbe = await probeAudio(audioPath);
    const sourceStat = await stat(audioPath);
    const sourceFingerprint = {
      sizeBytes: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
    };
    const existingManifest = shouldResume
      ? await readManifest(manifestPath)
      : undefined;
    let existingCheckpoint: TranscribeCheckpoint | undefined;
    if (shouldResume) {
      try {
        existingCheckpoint = await readTranscribeCheckpoint(checkpointPath);
      } catch (error) {
        throw new Error(`Cannot resume checkpoint at ${checkpointPath}; rebuild with --force.`, { cause: error });
      }
    }
    const audioSettings = {
      denoise: Boolean(flags.denoise),
      voiceBoost: Boolean(flags["voice-boost"]),
      sampleRate: 16000,
    };
    const chunkSettings = {
      chunkSeconds: flags["chunk-seconds"],
      boundarySearchSeconds: flags["boundary-search-seconds"],
      boundaryMaxSearchSeconds: flags["boundary-max-search-seconds"],
      overlapSeconds: flags["overlap-seconds"],
      keepSilence: Boolean(flags["keep-silence"]),
      silencePaddingSeconds: flags["silence-padding-seconds"],
      minimumSpeechSeconds: flags["minimum-speech-seconds"],
    };
    const preparedChannelPaths = Array.from(
      { length: sourceProbe.channels > 1 ? sourceProbe.channels : 0 },
      (_, index) => ({
        id: channelId(index, sourceProbe.channels),
        index,
        path: join(channelsDir, `${channelId(index, sourceProbe.channels)}.flac`),
      }),
    );
    if (existingManifest) {
      const compatibilityIssues = manifestCompatibilityIssues(existingManifest, {
        source: audioPath,
        sourceFingerprint,
        sourceProbe,
        normalizedStereo: normalizedPath,
        preparedChannels: preparedChannelPaths,
        audioSettings,
        chunkSettings,
      });
      if (compatibilityIssues.length > 0) {
        throw new Error(
          `Cannot resume stale audio preparation (${compatibilityIssues.join(", ")}); rebuild with --force.`,
        );
      }
    }
    const reusedNormalizedAudio = canReuseDependentAudio(
      shouldResume,
      existingManifest,
      await exists(normalizedPath),
    );
    const overwritePreparedAudio = shouldOverwritePreparedAudio(
      Boolean(flags.force),
      shouldResume,
      reusedNormalizedAudio,
    );
    if (existingCheckpoint && (existingCheckpoint.source !== audioPath ||
        existingCheckpoint.outDir !== outDir ||
        existingCheckpoint.sessionDate !== flags["session-date"] ||
        existingCheckpoint.campaign !== flags.campaign)) {
      throw new Error(`Cannot resume incompatible checkpoint at ${checkpointPath}; rebuild with --force.`);
    }

    const initialPasses = requiredPasses(effectiveProfile.layout, preparedChannelPaths);
    const initialPassIds = initialPasses.map((pass) => pass.id);
    const initialAvailable = existingManifest?.chunks.map((chunk) => chunk.index) ?? [];
    const initialAvailableByPass = Object.fromEntries(
      initialPassIds.map((id) => [id, initialAvailable]),
    );
    const checkpoint = baseCheckpoint({
      source: audioPath,
      outDir,
      campaign: flags.campaign,
      sessionDate: flags["session-date"],
      normalizedPath,
      chunksDir,
      rawChunksDir,
      rawTranscriptionDir,
      rawTranscriptPath,
      correctedTranscriptPath,
      correctionNotesPath,
      notesPath,
      chunkCount: initialAvailable.length,
      profile: effectiveProfile.name,
      layout: effectiveProfile.layout,
      requiredPassIds: initialPassIds,
      availableByPass: initialAvailableByPass,
      selection: existingManifest
        ? parseChunkSelection(flags.chunks, initialAvailable)
        : [],
    });
    if (existingCheckpoint && existingManifest) {
      checkpoint.stages.transcribed_chunks.completedByPass = Object.fromEntries(
        initialPassIds.map((id) => [
          id,
          existingCheckpoint.stages.transcribed_chunks.completedByPass[id] ?? [],
        ]),
      );
      checkpoint.stages.transcribed_chunks.cacheIdentityByPass = existingCheckpoint.stages.transcribed_chunks.cacheIdentityByPass;

      const previousRaw = existingCheckpoint.stages.joining_raw_transcription;
      if (previousRaw.status === "complete" && previousRaw.path && await exists(previousRaw.path)) {
        checkpoint.stages.joining_raw_transcription = previousRaw;
      }
      const previousCorrection = existingCheckpoint.stages.correction_pass;
      if (previousCorrection.status === "skipped" ||
          (previousCorrection.status === "complete" && previousCorrection.finalTranscriptPath && await exists(previousCorrection.finalTranscriptPath))) {
        checkpoint.stages.correction_pass = previousCorrection;
      }
      const previousNotes = existingCheckpoint.stages.notes_summary_pass;
      if (previousNotes.status === "skipped" ||
          (previousNotes.status === "complete" && previousNotes.notesPath && await exists(previousNotes.notesPath))) {
        checkpoint.stages.notes_summary_pass = previousNotes;
      }
      if (existingCheckpoint.stages.done.status === "complete" &&
          checkpoint.stages.joining_raw_transcription.status === "complete" &&
          ["complete", "skipped"].includes(checkpoint.stages.correction_pass.status) &&
          ["complete", "skipped"].includes(checkpoint.stages.notes_summary_pass.status)) {
        checkpoint.stages.done = existingCheckpoint.stages.done;
      }
    }

    const normalize = async (): Promise<void> => {
      await mkdir(join(outDir, "normalized"), { recursive: true });
      if (reusedNormalizedAudio) {
        this.process.stdout.write(`Resuming with existing normalized audio at ${normalizedPath}\n`);
        return;
      }
      this.process.stdout.write(`Normalizing audio to ${normalizedPath}\n`);
      await normalizeToFlac(
        audioPath,
        normalizedPath,
        overwritePreparedAudio,
        {
          denoise: Boolean(flags.denoise),
          voiceBoost: Boolean(flags["voice-boost"]),
        },
        {
          sink: this.process.stdout,
          totalSeconds: sourceProbe.durationSeconds,
        },
        sourceProbe.channels,
      );
    };

    const prepareAudio = async (): Promise<import("./pipeline.js").PreparedPipelineContext> => {
      await mkdir(chunksDir, { recursive: true });
      await mkdir(rawChunksDir, { recursive: true });
      await mkdir(rawTranscriptionDir, { recursive: true });

      let preparedChannels: Manifest["preparedChannels"];
      if (sourceProbe.channels > 1) {
        const channelPaths = preparedChannelPaths.map((channel) => channel.path);
        const allChannelsExist = (await Promise.all(channelPaths.map(exists))).every(Boolean);
        if (!reusedNormalizedAudio || !allChannelsExist) {
          preparedChannels = await deriveMonoChannels({
            stereoPath: normalizedPath,
            channelsDir,
            channelCount: sourceProbe.channels,
            force: shouldOverwritePreparedChannels(
              overwritePreparedAudio,
              shouldResume,
              reusedNormalizedAudio,
              allChannelsExist,
            ),
            progress: { sink: this.process.stdout },
          });
        } else {
          preparedChannels = preparedChannelPaths;
        }
      } else {
        preparedChannels = [];
      }

      const audioPasses = requiredPasses(effectiveProfile.layout, preparedChannels);
      let manifest: Manifest | undefined;
      let chunkPaths: string[] | undefined;
      let silences = reusedNormalizedAudio ? existingManifest?.silences : undefined;
      if (existingManifest && reusedNormalizedAudio) {
        const reusableChunks = await canReusePassAudioChunks({
          manifest: existingManifest,
          chunksRoot: chunksDir,
          passes: audioPasses,
        });
        manifest = existingManifest;
        chunkPaths = reusableChunks.pathsByPass["stereo"] ?? [];
        const missingStereo = reusableChunks.missingIndexesByPass["stereo"] ?? [];
        if (missingStereo.length > 0) {
          await writeChunkFlacs(
            normalizedPath,
            chunksDir,
            existingManifest.chunks.filter((chunk) => missingStereo.includes(chunk.index)),
            false,
            { sink: this.process.stdout },
          );
        } else {
          this.process.stdout.write(`Resuming with ${chunkPaths.length} existing audio chunks\n`);
        }
      }

      if (!manifest || !chunkPaths) {
        this.process.stdout.write("Detecting silence boundaries\n");
        const durationSeconds = await getAudioDurationSeconds(normalizedPath);
        silences = await detectSilences(normalizedPath);
        const plannedChunks = planChunks({
          durationSeconds,
          chunkSeconds: flags["chunk-seconds"],
          boundarySearchSeconds: flags["boundary-search-seconds"],
          boundaryMaxSearchSeconds: flags["boundary-max-search-seconds"],
          overlapSeconds: flags["overlap-seconds"],
          silences,
        });
        const chunks = flags["keep-silence"]
          ? plannedChunks
          : trimChunksToSpeech({
              chunks: plannedChunks,
              silences,
              paddingSeconds: flags["silence-padding-seconds"],
              minimumSpeechSeconds: flags["minimum-speech-seconds"],
            });
        manifest = {
          version: 2,
          source: audioPath,
          sourceFingerprint,
          sourceProbe,
          normalizedStereo: normalizedPath,
          preparedChannels,
          audioSettings,
          chunkSettings,
          durationSeconds,
          silences,
          chunks,
        };
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        this.process.stdout.write(`Writing ${chunks.length} FLAC chunks\n`);
        chunkPaths = await writeChunkFlacs(
          normalizedPath,
          chunksDir,
          chunks,
          overwritePreparedAudio,
          { sink: this.process.stdout },
        );
      }

      if (!manifest || !chunkPaths) {
        throw new Error("Audio manifest and chunk paths were not prepared.");
      }
      if (effectiveProfile.layout === "hybrid") {
        for (const channel of preparedChannels) {
          const pass = { kind: "channel" as const, id: channel.id, channelIndex: channel.index };
          const missingChunks = [];
          for (const chunk of manifest.chunks) {
            if (!(await exists(chunkAudioPathFor(chunksDir, pass, chunk.index)))) missingChunks.push(chunk);
          }
          if (missingChunks.length > 0) {
            this.process.stdout.write(`Writing ${missingChunks.length} ${channel.id} channel chunks\n`);
            await writeChunkFlacs(
              channel.path,
              chunksDir,
              missingChunks,
              Boolean(flags.force),
              { sink: this.process.stdout },
              pass,
            );
          }
        }
      }
      if (!silences) {
        this.process.stdout.write("Detecting silence boundaries for transcript tags\n");
        silences = await detectSilences(normalizedPath);
        manifest = { ...manifest, silences };
      }
      return {
        manifest,
        profile: effectiveProfile,
        rawChunksDir,
        rawTranscriptionDir,
        chunksDir,
        source: audioPath,
        backend: effectiveProfile.target.provider,
        model: effectiveProfile.target.model,
        silenceTagMinimumSeconds: flags["silence-tag-seconds"],
      };
    };

    const localRunner = async (request: import("./sttBackend.js").TranscribePassRequest): Promise<ChunkTranscript[]> => {
      const tempDir = join(outDir, ".stt-run", `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(tempDir, { recursive: true });
      try {
        const paths = request.target.provider === "nodejs-whisper"
          ? await transcribeChunksWithNodeWhisper({ chunkPaths: request.chunks.map((chunk) => chunk.path), outDir: tempDir, model: request.target.model, language: request.language, modelRootPath: flags["node-whisper-model-root"], autoDownloadModel: Boolean(flags["auto-download-model"]), device: flags.device, force: true })
          : await transcribeChunksWithLocalWhisper({ chunkPaths: request.chunks.map((chunk) => chunk.path), outDir: tempDir, model: request.target.model, language: request.language, device: flags.device, computeType: flags["compute-type"], python: flags.python, force: true });
        return Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as ChunkTranscript));
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    };
    const effectiveStopAfter = forcedStopAfter ?? parseStopAfter(flags["stop-after"]);
    let correctionRulesPromise: Promise<string> | undefined;
    const getCorrectionRules = (): Promise<string> => {
      correctionRulesPromise ??= (async () => {
        const correctionRules = await loadCorrectionRulesMarkdown({
          cwd,
          path: correctionsPath,
          campaign: flags.campaign,
          sessionDate: flags["session-date"],
        });
        const correctionRulesContextPath = await writeCorrectionRulesContext({
          outDir,
          correctionRules,
        });
        this.process.stdout.write(`Loaded shared correction rules at ${correctionRulesContextPath}\n`);
        return correctionRules;
      })();
      return correctionRulesPromise;
    };

    let transcriptForNotes = rawTranscriptPath;
    let transcriptChunksForNotes = rawTranscriptionDir;
    let correctionNotesForNotes: string | undefined;
    let correctionNotesChunksForNotes: string | undefined;
    const correctionReview = async (): Promise<"complete" | "skipped"> => {
      const correctionRules = await getCorrectionRules();
      this.process.stdout.write("Building campaign glossary\n");
      const glossaryPath = await writeGlossary({
        contextRoot,
        campaign: flags.campaign,
        outDir,
      });
      if (flags["skip-correction"]) {
        checkpoint.stages.correction_pass = { status: "pending" };
        return "skipped";
      }

      this.process.stdout.write("Running Codex correction pass\n");
      await runCodexCorrection({
        cwd,
        transcriptPath: rawTranscriptPath,
        glossaryPath,
        correctionRules,
        correctedTranscriptPath,
        correctionNotesPath,
        rawTranscriptionDir,
        force: Boolean(flags.force),
      });
      transcriptForNotes = correctedTranscriptPath;
      transcriptChunksForNotes = correctedTranscriptionDirFor(outDir);
      correctionNotesForNotes = correctionNotesPath;
      correctionNotesChunksForNotes = correctionNotesChunksDirFor(outDir);

      if (reviewSettings.provider === "hermes") {
        this.process.stdout.write("Running Hermes transcript reconciliation\n");
        const reviewPaths = await runHermesTranscriptReview({
          cwd,
          campaign: flags.campaign,
          sessionDate: flags["session-date"],
          rawTranscriptionDir,
          correctedTranscriptionDir: transcriptChunksForNotes,
          correctionNotesChunksDir: correctionNotesChunksForNotes,
          outDir,
          reconciledTranscriptPath,
          reviewNotesPath: hermesReviewNotesPath,
          profile: reviewSettings.hermesProfile,
          maxTurns: reviewSettings.hermesMaxTurns,
          resume: shouldResume,
          force: Boolean(flags.force),
          onProgress: (message) => this.process.stdout.write(message),
        });
        transcriptForNotes = reviewPaths.reconciledTranscriptPath;
        transcriptChunksForNotes = reviewPaths.reconciledTranscriptionDir;
        correctionNotesForNotes = reviewPaths.reviewNotesPath;
        correctionNotesChunksForNotes = reviewPaths.reviewNotesChunksDir;
      }

      checkpoint.stages.correction_pass = {
        status: "pending",
        correctedTranscriptPath,
        correctionNotesPath,
        reviewProvider: reviewSettings.provider,
        reconciledTranscriptPath:
          reviewSettings.provider === "hermes"
            ? reconciledTranscriptPath
            : undefined,
        hermesReviewNotesPath:
          reviewSettings.provider === "hermes"
            ? hermesReviewNotesPath
            : undefined,
        finalTranscriptPath: transcriptForNotes,
        finalCorrectionNotesPath: correctionNotesForNotes,
      };
      return "complete";
    };

    const notes = async (): Promise<"complete" | "skipped"> => {
      if (flags["skip-notes"]) {
        checkpoint.stages.notes_summary_pass = { status: "pending" };
        return "skipped";
      }
      if ((await exists(notesPath)) && !flags.force && !shouldResume) {
        throw new Error(`${notesPath} already exists. Pass --force to overwrite it.`);
      }
      const correctionRules = await getCorrectionRules();
      this.process.stdout.write(`Generating Astro notes at ${notesPath}\n`);
      const contextFiles = await collectContextFiles({
        contextRoot,
        campaign: flags.campaign,
        outDir,
        maxFiles: 40,
      });
      if (flags["notes-backend"] === "ollama") {
        await runOllamaHierarchicalNotes({
          campaign: flags.campaign,
          sessionDate: flags["session-date"],
          transcriptPath: transcriptForNotes,
          correctionNotesPath: correctionNotesForNotes,
          contextExcerpt: buildContextExcerpt(contextFiles),
          correctionRules,
          notesPath,
          outDir,
          model: flags["notes-model"],
          baseUrl: flags["ollama-url"],
          chunkChars: flags["summary-chunk-chars"],
          sceneGroupSize: flags["summary-scene-size"],
          force: Boolean(flags.force),
          resume: shouldResume,
        });
      } else {
        const notesTranscriptPath = flags["skip-summary-cleanup"]
          ? transcriptForNotes
          : summaryTranscriptPath;
        const notesTranscriptChunksDir = flags["skip-summary-cleanup"]
          ? transcriptChunksForNotes
          : summaryTranscriptionDirFor(outDir);
        if (!flags["skip-summary-cleanup"]) {
          this.process.stdout.write(`Preparing summary-safe transcript at ${summaryTranscriptPath}\n`);
          await runCodexSummaryCleanup({
            cwd,
            transcriptPath: transcriptForNotes,
            summaryTranscriptPath,
            transcriptChunksDir: transcriptChunksForNotes,
            outDir,
            chunkChars: flags["summary-chunk-chars"],
            onProgress: (message) => this.process.stdout.write(message),
            force: Boolean(flags.force),
            resume: shouldResume,
          });
        }
        await runCodexNotes({
          cwd,
          campaign: flags.campaign,
          sessionDate: flags["session-date"],
          transcriptPath: notesTranscriptPath,
          correctionNotesPath: correctionNotesForNotes,
          transcriptChunksDir: notesTranscriptChunksDir,
          correctionNotesChunksDir: correctionNotesChunksForNotes,
          contextExcerpt: buildContextExcerpt(contextFiles),
          correctionRules,
          notesPath,
          outDir,
          chunkChars: flags["summary-chunk-chars"],
          sceneGroupSize: flags["summary-scene-size"],
          onProgress: (message) => this.process.stdout.write(message),
          force: Boolean(flags.force),
          resume: shouldResume,
        });
      }
      return "complete";
    };

    const pipelineResult = await executeTranscriptionPipeline({
      normalize,
      prepareAudio,
      checkpointPath,
      checkpoint,
      rawChunksDir,
      rawTranscriptionDir,
      chunksDir,
      language: flags.language,
      selection: flags.chunks,
      force: Boolean(flags.force),
      stopAfter: effectiveStopAfter,
      source: audioPath,
      backend: effectiveProfile.target.provider,
      model: effectiveProfile.target.model,
      silenceTagMinimumSeconds: flags["silence-tag-seconds"],
      dependencies: { nodejsWhisper: localRunner, fasterWhisper: localRunner },
      onProgress: (message) => this.process.stdout.write(message),
      stages: {
        correctionReview,
        notes,
      },
    });
    if (effectiveStopAfter) {
      this.process.stdout.write(`Stopped after ${effectiveStopAfter}: ${checkpointPath}\n`);
      return;
    }
    if (pipelineResult.checkpoint.stages.transcribed_chunks.status !== "complete" || effectiveProfile.layout === "hybrid") {
      this.process.stdout.write(`Pass transcription preparation saved; downstream stages remain pending: ${checkpointPath}\n`);
      return;
    }
    this.process.stdout.write(`Transcript workflow complete: ${outDir}\n`);
  },
  parameters: {
    flags,
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Audio file to transcribe",
        },
      ],
    },
  },
  docs: {
    brief,
  },
  });
}

export const transcribeRunCommand = buildTranscribeRunCommand();
export const transcribePrepareCommand = buildTranscribeRunCommand("audio-chunking", "Normalize and chunk campaign audio without transcribing");

export const transcribeCommand = buildRouteMap({
  routes: {
    run: transcribeRunCommand,
    prepare: transcribePrepareCommand,
    audio: transcribeRunCommand,
    channels: channelsCommand,
    "apply-corrections": applyCorrectionsCommand,
    archive: archiveCommand,
  },
  defaultCommand: "run",
  docs: {
    brief:
      "Normalize, chunk, transcribe, correct, and summarize campaign audio",
  },
});
