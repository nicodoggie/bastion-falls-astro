import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

export const checkpointFileName = "checkpoint.json";
const isoDateTimeSchema = z.string().datetime({ offset: true });
const bounded = z.string().min(1).max(16_384);
const safePath = bounded.refine((value) => !value.includes("\0") && !value.split(/[\\/]/u).includes(".."), "unsafe path");
const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const safeChunkId = z.string().regex(/^session_[0-9]{1,6}$/u);
const boundedArray = <T extends z.ZodTypeAny>(item: T, max = 4096) => z.array(item).max(max);
const boundedRecord = <T extends z.ZodTypeAny>(item: T, max = 4096) => z.record(safeId, item).superRefine((value, ctx) => { if (Object.keys(value).length > max) ctx.addIssue({ code: "custom", message: "too many records" }); });

export const CheckpointStageStatusSchema = z.enum(["pending", "in_progress", "complete", "failed", "skipped"]);
const BaseStageSchema = z.object({ status: CheckpointStageStatusSchema, startedAt: isoDateTimeSchema.optional(), completedAt: isoDateTimeSchema.optional(), error: bounded.optional() }).strict();
export const NormalizationCheckpointSchema = BaseStageSchema.extend({ path: safePath.optional() }).strict();
export const AudioChunkingCheckpointSchema = BaseStageSchema.extend({ count: z.number().int().nonnegative().max(1_000_000).optional(), dir: safePath.optional(), requiredPasses: boundedArray(safeId), availableByPass: boundedRecord(boundedArray(z.number().int().nonnegative().max(1_000_000))) }).strict();
export const TranscribedChunksCheckpointSchema = BaseStageSchema.extend({ requiredPasses: boundedArray(safeId), completedByPass: boundedRecord(boundedArray(z.number().int().nonnegative().max(1_000_000))), selection: boundedArray(z.number().int().nonnegative().max(1_000_000)), total: z.number().int().nonnegative().max(1_000_000).optional(), rawChunksDir: safePath.optional(), rawTranscriptionDir: safePath.optional(), cacheIdentityByPass: boundedRecord(bounded) .optional() }).strict();
export const JoiningRawTranscriptionCheckpointSchema = BaseStageSchema.extend({ path: safePath.optional(), alignmentDir: safePath.optional(), alignmentIdentity: bounded.optional() }).strict();

export const CorrectionPassCheckpointSchema = BaseStageSchema.extend({ correctedTranscriptPath: safePath.optional(), correctionNotesPath: safePath.optional(), reviewProvider: z.enum(["hermes", "off"]).optional(), reconciledTranscriptPath: safePath.optional(), hermesReviewNotesPath: safePath.optional(), finalTranscriptPath: safePath.optional(), finalCorrectionNotesPath: safePath.optional() }).strict();

export const ReconciliationMetadataSchema = z.object({
  provider: z.enum(["hermes", "off", "legacy"]),
  mode: z.enum(["enabled", "off", "legacy"]),
  reconciliationDir: safePath,
  reconciledTranscriptPath: safePath,
  summaryTranscriptPath: safePath,
  reviewQueuePath: safePath,
  schemaVersion: bounded,
  promptVersion: bounded,
  cacheIdentityByChunk: boundedRecord(bounded),
  completedChunkIds: boundedArray(safeChunkId),
  status: z.enum(["valid", "needs_review", "invalid", "pending"]),
  summarySafety: z.object({ pendingChunkIds: boundedArray(safeChunkId), bypassChunkIds: boundedArray(safeChunkId) }).strict(),
}).strict().superRefine((value, ctx) => {
  const completed = new Set(value.completedChunkIds);
  const cacheIds = Object.keys(value.cacheIdentityByChunk);
  if (new Set(value.completedChunkIds).size !== value.completedChunkIds.length) ctx.addIssue({ code: "custom", message: "completed chunk IDs must be unique", path: ["completedChunkIds"] });
  if (new Set(value.summarySafety.pendingChunkIds).size !== value.summarySafety.pendingChunkIds.length || new Set(value.summarySafety.bypassChunkIds).size !== value.summarySafety.bypassChunkIds.length) ctx.addIssue({ code: "custom", message: "summary-safety chunk IDs must be unique", path: ["summarySafety"] });
  if (value.summarySafety.pendingChunkIds.some((id) => value.summarySafety.bypassChunkIds.includes(id))) ctx.addIssue({ code: "custom", message: "pending and bypass chunk IDs overlap", path: ["summarySafety"] });
  if (value.status === "valid" && value.summarySafety.pendingChunkIds.length > 0) ctx.addIssue({ code: "custom", message: "valid reconciliation cannot have pending summary safety", path: ["status"] });
  if (cacheIds.some((id) => !safeChunkId.safeParse(id).success) || cacheIds.length !== completed.size || cacheIds.some((id) => !completed.has(id))) ctx.addIssue({ code: "custom", message: "cache identities must exactly match completed chunks", path: ["cacheIdentityByChunk"] });
});
export type ReconciliationMetadata = z.infer<typeof ReconciliationMetadataSchema>;
export const ReconciliationCheckpointSchema = BaseStageSchema.extend({ metadata: ReconciliationMetadataSchema, compatibility: z.object({ correctionPass: CorrectionPassCheckpointSchema }).strict().optional() }).strict().superRefine((value, ctx) => {
  if (value.status === "failed" && (!value.error || value.completedAt !== undefined)) ctx.addIssue({ code: "custom", message: "failed reconciliation requires an error and no completion timestamp" });
});
export const NotesSummaryPassCheckpointSchema = BaseStageSchema.extend({ notesPath: safePath.optional() }).strict();
export const DoneCheckpointSchema = BaseStageSchema;
const CommonSchema = z.object({ updatedAt: isoDateTimeSchema, source: safePath, outDir: safePath, sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), campaign: bounded, profile: bounded, layout: z.enum(["stereo", "hybrid"]) });
const StageSchema = z.object({ normalization: NormalizationCheckpointSchema, audio_chunking: AudioChunkingCheckpointSchema, transcribed_chunks: TranscribedChunksCheckpointSchema, joining_raw_transcription: JoiningRawTranscriptionCheckpointSchema, reconciliation: ReconciliationCheckpointSchema, notes_summary_pass: NotesSummaryPassCheckpointSchema, done: DoneCheckpointSchema }).strict();
export const TranscribeCheckpointSchema = CommonSchema.extend({ version: z.literal(3), stages: StageSchema }).strict().superRefine(validateCheckpoint);
export const TranscribeCheckpointV2Schema = z.object({
  version: z.literal(2),
  ...CommonSchema.shape,
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

function indexes(values: number[]): boolean { return new Set(values).size === values.length && values.every((value, i) => i === 0 || value > values[i - 1]!); }
function validateCheckpoint(checkpoint: z.infer<typeof TranscribeCheckpointSchema>, ctx: z.RefinementCtx): void {
  const audio = checkpoint.stages.audio_chunking, transcribed = checkpoint.stages.transcribed_chunks;
  const required = audio.requiredPasses;
  if (new Set(required).size !== required.length || JSON.stringify([...required].sort()) !== JSON.stringify([...transcribed.requiredPasses].sort()) || Object.keys(audio.availableByPass).sort().join("\0") !== [...required].sort().join("\0") || Object.keys(transcribed.completedByPass).sort().join("\0") !== [...required].sort().join("\0")) ctx.addIssue({ code: "custom", message: "checkpoint pass manifests must agree", path: ["stages"] });
  for (const id of required) { const available = audio.availableByPass[id] ?? [], completed = transcribed.completedByPass[id] ?? []; if (!indexes(available) || !indexes(completed) || completed.some((index) => !available.includes(index))) ctx.addIssue({ code: "custom", message: "pass indexes must be sorted subsets of availability", path: ["stages"] }); }
  if (!indexes(transcribed.selection) || required.some((id) => transcribed.selection.some((index) => !(audio.availableByPass[id] ?? []).includes(index)))) ctx.addIssue({ code: "custom", message: "selection must be available in every required pass", path: ["stages"] });
  if (transcribed.status === "complete" && required.some((id) => (transcribed.completedByPass[id] ?? []).length !== (audio.availableByPass[id] ?? []).length)) ctx.addIssue({ code: "custom", message: "complete transcription requires every available chunk", path: ["stages"] });
  const mandatory = [checkpoint.stages.normalization, audio, transcribed, checkpoint.stages.joining_raw_transcription];
  if (mandatory.some((stage) => stage.status === "skipped")) ctx.addIssue({ code: "custom", message: "mandatory checkpoint stages cannot be skipped", path: ["stages"] });
  const reconciliation = checkpoint.stages.reconciliation;
  if (reconciliation.status === "complete" && !["valid", "needs_review", "skipped"].includes(reconciliation.metadata.status)) ctx.addIssue({ code: "custom", message: "invalid reconciliation cannot be complete", path: ["stages", "reconciliation"] });
  if (reconciliation.metadata.status === "pending" && reconciliation.status === "complete") ctx.addIssue({ code: "custom", message: "pending reconciliation cannot be complete", path: ["stages", "reconciliation"] });
  if (checkpoint.stages.done.status === "complete" && (mandatory.some((stage) => stage.status !== "complete") || !["complete", "skipped"].includes(reconciliation.status) || (reconciliation.status !== "skipped" && !["valid", "needs_review"].includes(reconciliation.metadata.status)) || !["complete", "skipped"].includes(checkpoint.stages.notes_summary_pass.status))) ctx.addIssue({ code: "custom", message: "done requires truthful terminal stages", path: ["stages", "done"] });
}

export type CheckpointStageStatus = z.infer<typeof CheckpointStageStatusSchema>;
export type TranscribeCheckpointV3 = z.infer<typeof TranscribeCheckpointSchema>;
export type TranscribeCheckpointV2 = z.infer<typeof TranscribeCheckpointV2Schema>;
export type TranscribeCheckpoint = TranscribeCheckpointV3;
export function getCheckpointPath(outDir: string): string { return join(outDir, checkpointFileName); }

function migrateV2(input: unknown): TranscribeCheckpointV3 {
  const parsed = TranscribeCheckpointV2Schema.parse(input);
  const old = parsed.stages.correction_pass;
  const path = old.reconciledTranscriptPath ?? old.finalTranscriptPath ?? join(parsed.outDir, "reconciliation", "reconciled_transcript.md");
  const dir = dirname(path);
  const status = old.status === "complete" ? "valid" : "pending";
  const off = old.reviewProvider === "off" || old.status === "skipped";
  return TranscribeCheckpointSchema.parse({
    ...parsed,
    version: 3,
    stages: {
      normalization: parsed.stages.normalization,
      audio_chunking: parsed.stages.audio_chunking,
      transcribed_chunks: parsed.stages.transcribed_chunks,
      joining_raw_transcription: parsed.stages.joining_raw_transcription,
      reconciliation: {
        status: old.status,
        ...(old.startedAt ? { startedAt: old.startedAt } : {}),
        ...(old.status !== "failed" && old.completedAt ? { completedAt: old.completedAt } : {}),
        ...(old.error ? { error: old.error } : old.status === "failed" ? { error: "Historical correction stage failed without a recorded error." } : {}),
        metadata: {
          provider: off ? "off" : "legacy",
          mode: off ? "off" : "legacy",
          reconciliationDir: dir,
          reconciledTranscriptPath: path,
          summaryTranscriptPath: join(dir, "summary_transcript.md"),
          reviewQueuePath: join(dir, "reconciliation_review_queue.md"),
          schemaVersion: "legacy.v2",
          promptVersion: "legacy.v2",
          cacheIdentityByChunk: {},
          completedChunkIds: [],
          status,
          summarySafety: { pendingChunkIds: [], bypassChunkIds: [] },
        },
        compatibility: { correctionPass: old },
      },
      notes_summary_pass: parsed.stages.notes_summary_pass,
      done: parsed.stages.done,
    },
  });
}

export function parseTranscribeCheckpoint(input: unknown): TranscribeCheckpointV3 {
  if (input && typeof input === "object" && !Array.isArray(input) && (input as Record<string, unknown>)["version"] === 2) return migrateV2(input);
  return TranscribeCheckpointSchema.parse(input);
}
export async function readTranscribeCheckpoint(path: string): Promise<TranscribeCheckpointV3 | undefined> { let raw: string; try { raw = await readFile(path, "utf8"); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw error; } return parseTranscribeCheckpoint(JSON.parse(raw) as unknown); }
export async function writeTranscribeCheckpoint(path: string, checkpoint: TranscribeCheckpoint, hooks?: { beforeRename?: () => void | Promise<void> }): Promise<void> {
  const parsed = parseTranscribeCheckpoint(checkpoint);
  const parent = dirname(path);
  const tmpPath = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  await mkdir(parent, { recursive: true });
  try {
    const handle = await open(tmpPath, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await hooks?.beforeRename?.();
    await rename(tmpPath, path);
    const directory = await open(parent, "r");
    try { await directory.sync(); }
    finally { await directory.close(); }
  } finally { await rm(tmpPath, { force: true }); }
}
