import { buildCommand, buildRouteMap, type FlagParametersForType } from "@stricli/core";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";

import type { LocalContext } from "@/context.js";
import { getAudioDurationSeconds, normalizeToFlac, writeChunkFlacs } from "./audio.js";
import { detectSilences, trimChunksToSpeech } from "./silence.js";
import { planChunks } from "./chunkPlanner.js";
import { transcribeChunksWithLocalWhisper } from "./localWhisper.js";
import { transcribeChunksWithNodeWhisper } from "./nodeWhisper.js";
import { assembleTranscript, formatChunkTranscript } from "./assembly.js";
import type { ChunkTranscript, Manifest } from "./types.js";
import { buildContextExcerpt, collectContextFiles, writeGlossary } from "./context.js";
import { getNotesPath } from "./notes.js";
import {
  correctionNotesChunksDirFor,
  correctedTranscriptionDirFor,
  runCodexCorrection,
  runCodexNotes,
  runCodexSummaryCleanup,
  summaryTranscriptionDirFor,
} from "./codex.js";
import { defaultSttBackend, parseSttBackend, type SttBackend } from "./sttBackend.js";
import { canReuseAudioChunks, readManifest } from "./resume.js";
import { getCheckpointPath, writeTranscribeCheckpoint, type TranscribeCheckpoint } from "./checkpoint.js";
import { runOllamaHierarchicalNotes } from "./ollamaNotes.js";
import { applyCorrectionsCommand } from "./applyCorrections.js";

type NotesBackend = "codex" | "ollama";

interface TranscribeFlags {
  campaign: string;
  "session-date": string;
  out?: string;
  "context-root": string;
  "whisper-model": string;
  language: string;
  backend: SttBackend;
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
  "notes-backend": NotesBackend;
  "notes-model": string;
  "ollama-url": string;
  "summary-chunk-chars": number;
  "summary-scene-size": number;
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
    brief: "Whisper language code, e.g. en or tl; use auto for language autodetection",
    default: "en",
  },
  backend: {
    kind: "parsed",
    parse: parseSttBackend,
    brief: "STT backend: nodejs-whisper or faster-whisper",
    default: defaultSttBackend,
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
    brief: "Apply conservative ffmpeg noise reduction before speech normalization",
    optional: true,
  },
  "voice-boost": {
    kind: "boolean",
    brief: "Apply a mild speech-presence EQ boost before loudness normalization",
    optional: true,
  },
  "keep-silence": {
    kind: "boolean",
    brief: "Keep long leading/trailing silence in chunks instead of trimming it before transcription",
    optional: true,
  },
  "silence-padding-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief: "Seconds of context to keep around detected speech when trimming silent chunk edges",
    default: "1",
  },
  "minimum-speech-seconds": {
    kind: "parsed",
    parse: parseNumber,
    brief: "Drop planned chunks with less speech than this after silence trimming",
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
    brief: "Python executable with faster-whisper installed; ignored by nodejs-whisper",
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
    brief: "Skip the Codex transcript cleanup pass used to prepare safer note summaries",
    optional: true,
  },
  "skip-notes": {
    kind: "boolean",
    brief: "Skip Astro campaign note generation",
    optional: true,
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
};

function slugifyAudioPath(audioPath: string): string {
  const stem = basename(audioPath, extname(audioPath));
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
}

function resolveFromCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

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

async function readChunkTranscripts(jsonPaths: string[], manifest: Manifest): Promise<Array<Manifest["chunks"][number] & { transcript: ChunkTranscript }>> {
  return Promise.all(
    jsonPaths.map(async (jsonPath, index) => {
      const chunk = manifest.chunks[index];
      if (!chunk) {
        throw new Error(`Missing manifest chunk for ${jsonPath}`);
      }
      return {
        ...chunk,
        transcript: JSON.parse(await readFile(jsonPath, "utf8")) as ChunkTranscript,
      };
    }),
  );
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
  completedChunks?: number[];
}): TranscribeCheckpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    source: options.source,
    outDir: options.outDir,
    sessionDate: options.sessionDate,
    campaign: options.campaign,
    stages: {
      normalization: {
        status: "pending",
        path: options.normalizedPath,
      },
      audio_chunking: {
        status: "pending",
        count: options.chunkCount,
        dir: options.chunksDir,
      },
      transcribed_chunks: {
        status: "pending",
        completed: options.completedChunks ?? [],
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

async function writeChunkTranscriptFiles(options: {
  rawTranscriptionDir: string;
  chunks: Array<Manifest["chunks"][number] & { transcript: ChunkTranscript }>;
}): Promise<void> {
  await mkdir(options.rawTranscriptionDir, { recursive: true });
  await Promise.all(
    options.chunks.map((chunk) => writeFile(
      join(options.rawTranscriptionDir, `session_${String(chunk.index).padStart(3, "0")}.md`),
      formatChunkTranscript(chunk),
      "utf8",
    )),
  );
}

export const transcribeRunCommand = buildCommand({
  async func(this: LocalContext, flags: TranscribeFlags, audioFile: string) {
    assertSessionDate(flags["session-date"]);

    const cwd = this.currentPath;
    const audioPath = resolveFromCwd(cwd, audioFile);
    const contextRoot = resolveFromCwd(cwd, flags["context-root"]);
    const outDir = resolveFromCwd(cwd, flags.out ?? join(".bf-transcripts", slugifyAudioPath(audioPath)));
    const normalizedPath = join(outDir, "normalized", "session.flac");
    const chunksDir = join(outDir, "chunks");
    const rawChunksDir = join(outDir, "raw_chunks");
    const rawTranscriptionDir = join(outDir, "raw_transcription");
    const manifestPath = join(outDir, "manifest.json");
    const checkpointPath = getCheckpointPath(outDir);
    const rawTranscriptPath = join(outDir, "raw_transcript.md");
    const correctedTranscriptPath = join(outDir, "corrected_transcript.md");
    const summaryTranscriptPath = join(outDir, "summary_transcript.md");
    const correctionNotesPath = join(outDir, "correction_notes.md");
    const notesPath = getNotesPath({
      contextRoot,
      campaign: flags.campaign,
      sessionDate: flags["session-date"],
    });
    const shouldResume = Boolean(flags.resume) && !flags.force;

    if (!flags["skip-notes"] && (await exists(notesPath)) && !flags.force && !shouldResume) {
      throw new Error(`${notesPath} already exists. Pass --force to overwrite it.`);
    }

    await mkdir(outDir, { recursive: true });
    await mkdir(join(outDir, "normalized"), { recursive: true });
    await mkdir(chunksDir, { recursive: true });
    await mkdir(rawChunksDir, { recursive: true });
    await mkdir(rawTranscriptionDir, { recursive: true });

    if (shouldResume && (await exists(normalizedPath))) {
      this.process.stdout.write(`Resuming with existing normalized audio at ${normalizedPath}\n`);
    } else {
      const sourceDurationSeconds = await getAudioDurationSeconds(audioPath);
      this.process.stdout.write(`Normalizing audio to ${normalizedPath}\n`);
      await normalizeToFlac(
        audioPath,
        normalizedPath,
        Boolean(flags.force),
        {
          denoise: Boolean(flags.denoise),
          voiceBoost: Boolean(flags["voice-boost"]),
        },
        {
          sink: this.process.stdout,
          totalSeconds: sourceDurationSeconds,
        },
      );
    }

    let manifest: Manifest | undefined;
    let chunkPaths: string[] | undefined;
    const existingManifest = shouldResume ? await readManifest(manifestPath) : undefined;
    let silences = existingManifest?.silences;
    if (existingManifest) {
      const reusableChunks = await canReuseAudioChunks({ manifest: existingManifest, chunksDir });
      if (reusableChunks.reusable) {
        manifest = existingManifest;
        chunkPaths = reusableChunks.chunkPaths;
        this.process.stdout.write(`Resuming with ${chunkPaths.length} existing audio chunks\n`);
      } else {
        throw new Error(
          `Cannot resume audio chunking; missing chunk indexes: ${reusableChunks.missingIndexes.join(", ")}. Pass --force to rebuild chunks.`,
        );
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
        source: audioPath,
        normalized: normalizedPath,
        durationSeconds,
        chunkSeconds: flags["chunk-seconds"],
        boundarySearchSeconds: flags["boundary-search-seconds"],
        boundaryMaxSearchSeconds: flags["boundary-max-search-seconds"],
        overlapSeconds: flags["overlap-seconds"],
        silences,
        chunks,
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      this.process.stdout.write(`Writing ${chunks.length} FLAC chunks\n`);
      chunkPaths = await writeChunkFlacs(normalizedPath, chunksDir, chunks, Boolean(flags.force), {
        sink: this.process.stdout,
      });
    }

    if (!silences) {
      this.process.stdout.write("Detecting silence boundaries for transcript tags\n");
      silences = await detectSilences(normalizedPath);
    }

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
      chunkCount: manifest.chunks.length,
    });
    const now = new Date().toISOString();
    checkpoint.updatedAt = now;
    checkpoint.stages.normalization = { status: "complete", completedAt: now, path: normalizedPath };
    checkpoint.stages.audio_chunking = { status: "complete", completedAt: now, count: manifest.chunks.length, dir: chunksDir };
    await writeTranscribeCheckpoint(checkpointPath, checkpoint);

    this.process.stdout.write(`Transcribing chunks with ${flags.backend}\n`);
    const jsonPaths = flags.backend === "nodejs-whisper"
      ? await transcribeChunksWithNodeWhisper({
          chunkPaths,
          outDir: rawChunksDir,
          model: flags["whisper-model"],
          language: flags.language,
          modelRootPath: flags["node-whisper-model-root"],
          autoDownloadModel: Boolean(flags["auto-download-model"]),
          device: flags.device,
          force: Boolean(flags.force),
        })
      : await transcribeChunksWithLocalWhisper({
          chunkPaths,
          outDir: rawChunksDir,
          model: flags["whisper-model"],
          language: flags.language,
          device: flags.device,
          computeType: flags["compute-type"],
          python: flags.python,
          force: Boolean(flags.force),
        });

    this.process.stdout.write(`Assembling raw transcript at ${rawTranscriptPath}\n`);
    const chunkTranscripts = await readChunkTranscripts(jsonPaths, manifest);
    await writeChunkTranscriptFiles({ rawTranscriptionDir, chunks: chunkTranscripts });
    const completedChunkIndexes = chunkTranscripts.map((chunk) => chunk.index);
    checkpoint.updatedAt = new Date().toISOString();
    checkpoint.stages.transcribed_chunks = {
      status: "complete",
      completedAt: checkpoint.updatedAt,
      completed: completedChunkIndexes,
      total: manifest.chunks.length,
      rawChunksDir,
      rawTranscriptionDir,
    };
    await writeTranscribeCheckpoint(checkpointPath, checkpoint);
    await writeFile(
      rawTranscriptPath,
      assembleTranscript({
        source: audioPath,
        backend: flags.backend,
        model: flags["whisper-model"],
        chunks: chunkTranscripts,
        silences,
        silenceTagMinimumSeconds: flags["silence-tag-seconds"],
      }),
      "utf8",
    );
    checkpoint.updatedAt = new Date().toISOString();
    checkpoint.stages.joining_raw_transcription = {
      status: "complete",
      completedAt: checkpoint.updatedAt,
      path: rawTranscriptPath,
    };
    await writeTranscribeCheckpoint(checkpointPath, checkpoint);

    this.process.stdout.write("Building campaign glossary\n");
    const glossaryPath = await writeGlossary({
      contextRoot,
      campaign: flags.campaign,
      outDir,
    });

    let transcriptForNotes = rawTranscriptPath;
    if (!flags["skip-correction"]) {
      this.process.stdout.write("Running Codex correction pass\n");
      await runCodexCorrection({
        cwd,
        transcriptPath: rawTranscriptPath,
        glossaryPath,
        correctedTranscriptPath,
        correctionNotesPath,
        rawTranscriptionDir,
        force: Boolean(flags.force),
      });
      transcriptForNotes = correctedTranscriptPath;
      checkpoint.updatedAt = new Date().toISOString();
      checkpoint.stages.correction_pass = {
        status: "complete",
        completedAt: checkpoint.updatedAt,
        correctedTranscriptPath,
        correctionNotesPath,
      };
      await writeTranscribeCheckpoint(checkpointPath, checkpoint);
    }

    if (!flags["skip-notes"]) {
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
          correctionNotesPath: flags["skip-correction"] ? undefined : correctionNotesPath,
          contextExcerpt: buildContextExcerpt(contextFiles),
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
        const transcriptChunksDir = flags["skip-correction"] ? rawTranscriptionDir : correctedTranscriptionDirFor(outDir);
        const notesTranscriptPath = flags["skip-summary-cleanup"]
          ? transcriptForNotes
          : summaryTranscriptPath;
        const notesTranscriptChunksDir = flags["skip-summary-cleanup"]
          ? transcriptChunksDir
          : summaryTranscriptionDirFor(outDir);

        if (!flags["skip-summary-cleanup"]) {
          this.process.stdout.write(`Preparing summary-safe transcript at ${summaryTranscriptPath}\n`);
          await runCodexSummaryCleanup({
            cwd,
            transcriptPath: transcriptForNotes,
            summaryTranscriptPath,
            transcriptChunksDir,
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
          correctionNotesPath: flags["skip-correction"] ? undefined : correctionNotesPath,
          transcriptChunksDir: notesTranscriptChunksDir,
          correctionNotesChunksDir: flags["skip-correction"] ? undefined : correctionNotesChunksDirFor(outDir),
          contextExcerpt: buildContextExcerpt(contextFiles),
          notesPath,
          outDir,
          chunkChars: flags["summary-chunk-chars"],
          sceneGroupSize: flags["summary-scene-size"],
          onProgress: (message) => this.process.stdout.write(message),
          force: Boolean(flags.force),
          resume: shouldResume,
        });
      }
      checkpoint.updatedAt = new Date().toISOString();
      checkpoint.stages.notes_summary_pass = {
        status: "complete",
        completedAt: checkpoint.updatedAt,
        notesPath,
      };
      await writeTranscribeCheckpoint(checkpointPath, checkpoint);
    }

    checkpoint.updatedAt = new Date().toISOString();
    checkpoint.stages.done = { status: "complete", completedAt: checkpoint.updatedAt };
    await writeTranscribeCheckpoint(checkpointPath, checkpoint);
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
    brief: "Normalize, chunk, transcribe, correct, and summarize campaign audio",
  },
});

export const transcribeCommand = buildRouteMap({
  routes: {
    run: transcribeRunCommand,
    audio: transcribeRunCommand,
    "apply-corrections": applyCorrectionsCommand,
  },
  defaultCommand: "run",
  docs: {
    brief: "Normalize, chunk, transcribe, correct, and summarize campaign audio",
  },
});
