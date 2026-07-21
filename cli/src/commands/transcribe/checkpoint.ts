import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const checkpointFileName = "checkpoint.json";

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const CheckpointStageStatusSchema = z.enum(["pending", "in_progress", "complete", "failed"]);

const BaseStageSchema = z.object({
  status: CheckpointStageStatusSchema,
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  error: z.string().optional(),
}).strict();

export const NormalizationCheckpointSchema = BaseStageSchema.extend({
  path: z.string().optional(),
}).strict();

export const AudioChunkingCheckpointSchema = BaseStageSchema.extend({
  count: z.number().int().nonnegative().optional(),
  dir: z.string().optional(),
}).strict();

export const TranscribedChunksCheckpointSchema = BaseStageSchema.extend({
  completed: z.array(z.number().int().nonnegative()),
  total: z.number().int().nonnegative().optional(),
  rawChunksDir: z.string().optional(),
  rawTranscriptionDir: z.string().optional(),
}).strict();

export const JoiningRawTranscriptionCheckpointSchema = BaseStageSchema.extend({
  path: z.string().optional(),
}).strict();

export const CorrectionPassCheckpointSchema = BaseStageSchema.extend({
  correctedTranscriptPath: z.string().optional(),
  correctionNotesPath: z.string().optional(),
  reviewProvider: z.enum(["hermes", "off"]).optional(),
  reconciledTranscriptPath: z.string().optional(),
  hermesReviewNotesPath: z.string().optional(),
  finalTranscriptPath: z.string().optional(),
  finalCorrectionNotesPath: z.string().optional(),
}).strict();

export const NotesSummaryPassCheckpointSchema = BaseStageSchema.extend({
  notesPath: z.string().optional(),
}).strict();

export const DoneCheckpointSchema = BaseStageSchema;

export const TranscribeCheckpointSchema = z.object({
  version: z.literal(1),
  updatedAt: isoDateTimeSchema,
  source: z.string(),
  outDir: z.string(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaign: z.string().min(1),
  stages: z.object({
    normalization: NormalizationCheckpointSchema,
    audio_chunking: AudioChunkingCheckpointSchema,
    transcribed_chunks: TranscribedChunksCheckpointSchema,
    joining_raw_transcription: JoiningRawTranscriptionCheckpointSchema,
    correction_pass: CorrectionPassCheckpointSchema,
    notes_summary_pass: NotesSummaryPassCheckpointSchema,
    done: DoneCheckpointSchema,
  }).strict(),
}).strict();

export type CheckpointStageStatus = z.infer<typeof CheckpointStageStatusSchema>;
export type TranscribeCheckpoint = z.infer<typeof TranscribeCheckpointSchema>;

export function getCheckpointPath(outDir: string): string {
  return join(outDir, checkpointFileName);
}

export function parseTranscribeCheckpoint(input: unknown): TranscribeCheckpoint {
  return TranscribeCheckpointSchema.parse(input);
}

export async function readTranscribeCheckpoint(path: string): Promise<TranscribeCheckpoint | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  return parseTranscribeCheckpoint(JSON.parse(raw) as unknown);
}

export async function writeTranscribeCheckpoint(path: string, checkpoint: TranscribeCheckpoint): Promise<void> {
  const parsed = parseTranscribeCheckpoint(checkpoint);
  const tmpPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

