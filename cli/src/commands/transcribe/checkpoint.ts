import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const checkpointFileName = "checkpoint.json";

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const CheckpointStageStatusSchema = z.enum(["pending", "in_progress", "complete", "failed", "skipped"]);
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
  requiredPasses: z.array(z.string().min(1)),
  availableByPass: z.record(z.string().min(1), z.array(z.number().int().nonnegative())),
}).strict();

export const TranscribedChunksCheckpointSchema = BaseStageSchema.extend({
  requiredPasses: z.array(z.string().min(1)),
  completedByPass: z.record(z.string().min(1), z.array(z.number().int().nonnegative())),
  selection: z.array(z.number().int().nonnegative()),
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
const passIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const TranscribeCheckpointSchema = z.object({
  version: z.literal(2),
  updatedAt: isoDateTimeSchema,
  source: z.string(),
  outDir: z.string(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaign: z.string().min(1),
  profile: z.string().min(1),
  layout: z.enum(["stereo", "hybrid"]),
  stages: z.object({
    normalization: NormalizationCheckpointSchema,
    audio_chunking: AudioChunkingCheckpointSchema,
    transcribed_chunks: TranscribedChunksCheckpointSchema,
    joining_raw_transcription: JoiningRawTranscriptionCheckpointSchema,
    correction_pass: CorrectionPassCheckpointSchema,
    notes_summary_pass: NotesSummaryPassCheckpointSchema,
    done: DoneCheckpointSchema,
  }).strict(),
}).strict().superRefine((checkpoint, ctx) => {
  const audio = checkpoint.stages.audio_chunking;
  const transcribed = checkpoint.stages.transcribed_chunks;
  const required = audio.requiredPasses;
  const keys = (value: Record<string, unknown>) => Object.keys(value).sort();
  const unique = (values: string[]) => new Set(values).size === values.length;
  const validIndexes = (values: number[]) => unique(values.map(String)) && values.every((value, i) => Number.isInteger(value) && value >= 0 && (i === 0 || value > values[i - 1]!));
  if (!required.every((id) => passIdSchema.safeParse(id).success) || !unique(required) ||
      (checkpoint.layout === "stereo" && required.length !== 1) ||
      (checkpoint.layout === "stereo" && required[0] !== "stereo") ||
      (checkpoint.layout === "hybrid" && !required.includes("stereo"))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "requiredPasses must be unique, safe, and match layout", path: ["stages", "audio_chunking", "requiredPasses"] });
  }
  if (JSON.stringify([...required].sort()) !== JSON.stringify([...transcribed.requiredPasses].sort()) ||
      keys(audio.availableByPass) .join("\0") !== [...required].sort().join("\0") ||
      keys(transcribed.completedByPass).join("\0") !== [...required].sort().join("\0")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "checkpoint pass manifests must agree", path: ["stages"] });
  }
  for (const id of required) {
    const available = audio.availableByPass[id] ?? [];
    const completed = transcribed.completedByPass[id] ?? [];
    if (!validIndexes(available) || !validIndexes(completed) || completed.some((index) => !available.includes(index))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "pass indexes must be sorted subsets of availability", path: ["stages", "transcribed_chunks", "completedByPass", id] });
    }
  }
  if (!validIndexes(transcribed.selection) || required.some((id) => transcribed.selection.some((index) => !(audio.availableByPass[id] ?? []).includes(index)))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selection must be available in every required pass", path: ["stages", "transcribed_chunks", "selection"] });
  }
  if (audio.status === "complete" && required.some((id) => JSON.stringify(audio.availableByPass[id]) !== JSON.stringify(audio.availableByPass[required[0]!]) || (audio.count !== undefined && audio.availableByPass[id]!.length !== audio.count))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "complete audio chunking must have matching availability", path: ["stages", "audio_chunking"] });
  }
  if (transcribed.status === "complete" && required.some((id) => (transcribed.completedByPass[id] ?? []).length !== (audio.availableByPass[id] ?? []).length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "complete transcription requires every available chunk", path: ["stages", "transcribed_chunks"] });
  }
  const mandatory = [
    checkpoint.stages.normalization,
    audio,
    transcribed,
    checkpoint.stages.joining_raw_transcription,
  ];
  if (mandatory.some((stage) => stage.status === "skipped")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "mandatory checkpoint stages cannot be skipped",
      path: ["stages"],
    });
  }
  if (checkpoint.stages.done.status === "complete") {
    const optional = [checkpoint.stages.correction_pass, checkpoint.stages.notes_summary_pass];
    if (mandatory.some((stage) => stage.status !== "complete") || optional.some((stage) => !["complete", "skipped"].includes(stage.status))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "done requires truthful terminal stages", path: ["stages", "done"] });
    }
  }
});
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
