import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildCommand, type FlagParametersForType } from "@stricli/core";
import type { LocalContext } from "@/context.js";
import {
  runBenchmark,
  parseBenchmarkLane,
  collectCanonicalReceipt,
  type BenchmarkLane,
  type BenchmarkExecutor,
} from "./reconciliationBenchmark.js";
import { readTranscribeCheckpoint } from "./checkpoint.js";
import { parseAlignmentResult } from "./alignment.js";
import { readManifest } from "./resume.js";
import {
  runCodexNotes,
  runCodexSummaryCleanup,
} from "./codex.js";
import {
  collectContextFiles,
  buildContextExcerpt,
} from "./context.js";
import { loadCorrectionRulesMarkdown } from "./corrections.js";
import {
  runUnifiedReconciliationStage,
  runUnifiedStructuredNotes,
  type UnifiedStageOptions,
} from "./reconciliationIntegration.js";
import type { Manifest } from "./types.js";
import { stableHash } from "./reconciliationEvidence.js";
import { loadChannelMap } from "./channelMap.js";

export interface BenchmarkFlags {
  "trial-root": string;
  lanes: string;
  campaign: string;
  "session-date": string;
  "context-root": string;
  corrections?: string;
  profile?: string;
  "max-turns": number;
  "timeout-ms": number;
  "prompt-version": string;
  "schema-version": string;
}

export interface BenchmarkAdapterContext {
  campaign: string;
  sessionDate: string;
  contextRoot: string;
  corrections?: string;
  profile?: string;
  maxTurns: number;
  timeoutMs: number;
  promptVersion: string;
  schemaVersion: string;
  repositoryCwd: string;
}

export interface BenchmarkAdapterDependencies {
  runCodexSummaryCleanup?: typeof runCodexSummaryCleanup;
  runCodexNotes?: typeof runCodexNotes;
  runUnifiedReconciliationStage?: typeof runUnifiedReconciliationStage;
  runUnifiedStructuredNotes?: typeof runUnifiedStructuredNotes;
  loadCandidateInputs?: typeof loadCandidateInputs;
  loadSharedContext?: typeof sharedContext;
  readCheckpoint?: typeof readTranscribeCheckpoint;
  collectReceipt?: typeof collectCanonicalReceipt;
}

export function parseLanes(value: string): BenchmarkLane[] {
  if (!value.trim() || value.length > 200) throw new Error("lanes must be a bounded comma-separated list");
  const lanes = value.split(",").map((lane) => lane.trim()).filter(Boolean).map(parseBenchmarkLane);
  if (!lanes.length || new Set(lanes).size !== lanes.length) {
    throw new Error("lanes must be a distinct comma-separated list of baseline,single,window-3");
  }
  return lanes;
}

const parsePositiveInteger = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1_000) throw new Error("Expected a bounded positive integer");
  return parsed;
};
const parseTimeoutMs = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 600_000) throw new Error("Timeout must be an integer from 1000 to 600000 milliseconds");
  return parsed;
};
const parseBoundedString = (value: string): string => { if (!value.trim() || value.length > 2_000) throw new Error("Expected a bounded non-empty string"); return value; };
const parseSessionDate = (value: string): string => { if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("Session date must use YYYY-MM-DD"); return value; };

const flags: FlagParametersForType<BenchmarkFlags, LocalContext> = {
  "trial-root": { kind: "parsed", parse: parseBoundedString, brief: "Required separate trial root; source is immutable" },
  lanes: { kind: "parsed", parse: String, brief: "Distinct comma-separated lanes: baseline,single,window-3", default: "baseline,single,window-3" },
  campaign: { kind: "parsed", parse: parseBoundedString, brief: "Campaign slug used for comparable context" },
  "session-date": { kind: "parsed", parse: parseSessionDate, brief: "Session date, YYYY-MM-DD" },
  "context-root": { kind: "parsed", parse: parseBoundedString, brief: "Read-only repository context root" },
  corrections: { kind: "parsed", parse: parseBoundedString, brief: "Read-only shared correction rules YAML", optional: true },
  profile: { kind: "parsed", parse: parseBoundedString, brief: "Hermes profile for candidate lanes", optional: true },
  "max-turns": { kind: "parsed", parse: parsePositiveInteger, brief: "Bounded candidate model turns", default: "8" },
  "timeout-ms": { kind: "parsed", parse: parseTimeoutMs, brief: "Bounded candidate inference timeout in milliseconds", default: "120000" },
  "prompt-version": { kind: "parsed", parse: parseBoundedString, brief: "Candidate prompt version", default: "reconciliation.prompt.v1" },
  "schema-version": { kind: "parsed", parse: parseBoundedString, brief: "Candidate schema version", default: "reconciliation.v1" },
};

async function requiredFile(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file`);
}

async function loadCandidateInputs(sourceDir: string): Promise<{ manifest: Manifest; alignments: Record<string, ReturnType<typeof parseAlignmentResult>>; channelMap: Awaited<ReturnType<typeof loadChannelMap>> }> {
  const manifest = await readManifest(join(sourceDir, "manifest.json"));
  if (!manifest) throw new Error("candidate lane requires a strict manifest.json");
  const alignmentDir = join(sourceDir, "raw_transcription", "alignment");
  const names = (await readdir(alignmentDir)).filter((name) => /^session_[0-9]{3}\.json$/u.test(name)).sort();
  if (!names.length) throw new Error("candidate lane requires alignment artifacts");
  const alignments: Record<string, ReturnType<typeof parseAlignmentResult>> = {};
  for (const name of names) {
    const path = join(alignmentDir, name);
    await requiredFile(path, `alignment ${name}`);
    alignments[String(Number(name.match(/^session_(\d+)/u)![1]!))] = parseAlignmentResult(JSON.parse(await readFile(path, "utf8")) as unknown);
  }
  for (const chunk of manifest.chunks) if (!alignments[String(chunk.index)]) throw new Error(`missing alignment for STT chunk ${chunk.index}`);
  const channelMapPath = join(sourceDir, "channel-map.yml");
  await requiredFile(channelMapPath, "channel map");
  return { manifest, alignments, channelMap: await loadChannelMap(channelMapPath) };
}

async function sharedContext(options: BenchmarkAdapterContext, laneRoot: string): Promise<{ rules: string; excerpt: string }> {
  const files = await collectContextFiles({ contextRoot: options.contextRoot, campaign: options.campaign, outDir: laneRoot, maxFiles: 40, excludePathFragments: [options.sessionDate] });
  return {
    rules: await loadCorrectionRulesMarkdown({ cwd: options.repositoryCwd, path: options.corrections, campaign: options.campaign, sessionDate: options.sessionDate }),
    excerpt: buildContextExcerpt(files, options.contextRoot),
  };
}

function metrics(value: { artifactCount?: number; sourceEvents?: number; covered?: number; omitted?: number; overlapCount?: number; calls?: number; readableCompressionRatio?: number; summaryCompressionRatio?: number }): Record<string, number> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number>;
}

function boundedEvidenceLines(value: string): string[] {
  const lines: string[] = [];
  for (const raw of value.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    for (let offset = 0; offset < line.length; offset += 2_000) {
      lines.push(line.slice(offset, offset + 2_000));
      if (lines.length > 20_000) throw new Error("benchmark evidence context exceeds bounds");
    }
  }
  return lines;
}

async function countLaneFiles(root: string): Promise<number> {
  let count = 0;
  let totalBytes = 0;
  const maxFileBytes = 64 * 1024 * 1024;
  const maxTotalBytes = 1024 * 1024 * 1024;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("lane output contains a symlink");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("lane output contains an unsafe artifact");
        if (info.size > maxFileBytes) throw new Error("lane output artifact exceeds byte bounds");
        totalBytes += info.size;
        if (totalBytes > maxTotalBytes) throw new Error("lane output total exceeds byte bounds");
        count += 1;
        if (count > 10_000) throw new Error("lane output artifact count exceeds bounds");
      }
      else throw new Error("lane output contains a non-regular artifact");
    }
  };
  await visit(root);
  return count;
}

export function createBenchmarkExecutors(options: BenchmarkAdapterContext, deps: BenchmarkAdapterDependencies = {}): Record<BenchmarkLane, BenchmarkExecutor> {
  const legacySummary = deps.runCodexSummaryCleanup ?? runCodexSummaryCleanup;
  const legacyNotes = deps.runCodexNotes ?? runCodexNotes;
  const unifiedStage = deps.runUnifiedReconciliationStage ?? runUnifiedReconciliationStage;
  const unifiedNotes = deps.runUnifiedStructuredNotes ?? runUnifiedStructuredNotes;
  const candidateInputs = deps.loadCandidateInputs ?? loadCandidateInputs;
  const contextForLane = deps.loadSharedContext ?? sharedContext;
  const checkpointReader = deps.readCheckpoint ?? readTranscribeCheckpoint;
  const receiptCollector = deps.collectReceipt ?? collectCanonicalReceipt;

  const baseline: BenchmarkExecutor = async ({ rootDir, sourceDir }) => {
    const corrected = join(sourceDir, "corrected_transcript.md");
    await requiredFile(corrected, "approved corrected transcript");
    const laneTranscript = join(rootDir, "corrected_transcript.md");
    await requiredFile(laneTranscript, "lane corrected transcript snapshot");
    const context = await contextForLane(options, rootDir);
    const summaryPath = join(rootDir, "summary_transcript.md");
    await legacySummary({ cwd: options.repositoryCwd, transcriptPath: laneTranscript, summaryTranscriptPath: summaryPath, outDir: rootDir, chunkChars: 12000 });
    const notesPath = join(rootDir, `${options.campaign}-${options.sessionDate}.mdx`);
    await legacyNotes({ cwd: options.repositoryCwd, campaign: options.campaign, sessionDate: options.sessionDate, transcriptPath: summaryPath, contextExcerpt: context.excerpt, correctionRules: context.rules, notesPath, outDir: rootDir, chunkChars: 12000, sceneGroupSize: 5 });
    return { artifactCount: await countLaneFiles(rootDir), sourceEvents: 0, covered: 0, omitted: 0 };
  };

  const candidate = (layout: "single" | "three"): BenchmarkExecutor => async ({ rootDir, sourceDir }) => {
    const { manifest, alignments, channelMap } = await candidateInputs(sourceDir);
    const context = await contextForLane(options, rootDir);
    const sourceHash = (await receiptCollector(sourceDir)).receiptSha256;
    // A source checkpoint may describe authoritative campaign metadata, but is never resume state.
    const checkpoint = await checkpointReader(join(sourceDir, "checkpoint.json"));
    const campaign = checkpoint?.campaign ?? options.campaign;
    const sessionDate = checkpoint?.sessionDate ?? options.sessionDate;
    const stageOptions: UnifiedStageOptions = {
      rootDir,
      manifest,
      alignments,
      channelMap,
      layout,
      sourceHash,
      evidenceRevision: stableHash({ sourceHash, rules: context.rules, context: context.excerpt, promptVersion: options.promptVersion, schemaVersion: options.schemaVersion }),
      provider: { provider: "hermes", model: "hermes-chat", ...(options.profile ? { profile: options.profile } : {}) },
      correctionRules: boundedEvidenceLines(context.rules),
      glossary: boundedEvidenceLines(context.excerpt),
      campaign,
      sessionDate,
      promptVersion: options.promptVersion,
      schemaVersion: options.schemaVersion,
      profile: options.profile,
      maxTurns: options.maxTurns,
      timeoutMs: options.timeoutMs,
      repositoryCwd: options.repositoryCwd,
    };
    const result = await unifiedStage(stageOptions);
    await unifiedNotes({ outputRoot: rootDir, chunks: result.chunks, jobs: result.jobs, notePath: join(rootDir, `${campaign}-${sessionDate}.mdx`), summarization: { repositoryCwd: options.repositoryCwd, providerIdentity: { provider: "codex", model: "codex" }, campaignContext: context.excerpt, correctionRules: boundedEvidenceLines(context.rules), campaign, sessionDate, promptVersion: options.promptVersion, sceneGroupSize: 5 } });
    const sourceEvents = result.jobs.reduce((n, job) => n + job.authoritativeSourceEvents.length, 0);
    const omitted = result.chunks.reduce((n, chunk) => n + chunk.omissions.length, 0);
    const blocks = result.chunks.flatMap((chunk) => chunk.blocks);
    let overlapCount = 0;
    for (let left = 0; left < blocks.length; left++) for (let right = left + 1; right < blocks.length; right++) if (blocks[left]!.start < blocks[right]!.end && blocks[right]!.start < blocks[left]!.end) overlapCount += 1;
    const attribution = { confirmed: 0, probable: 0, unknown: 0, abstention: 0 };
    for (const block of blocks) attribution[block.characterConfidence] += 1;
    attribution.abstention = blocks.filter((block) => block.characterConfidence === "unknown" && block.characterCandidate === undefined).length;
    const sourceChars = result.jobs.reduce((n, job) => n + job.authoritativeSourceEvents.reduce((m, event) => m + event.text.length, 0), 0);
    const readableChars = blocks.reduce((n, block) => n + block.text.length, 0);
    const summaryChars = blocks.reduce((n, block) => n + block.summarySafeText.length, 0);
    return { ...metrics({ artifactCount: await countLaneFiles(rootDir), sourceEvents, covered: sourceEvents - omitted, omitted, overlapCount, calls: result.jobs.length, readableCompressionRatio: sourceChars > 0 ? readableChars / sourceChars : 0, summaryCompressionRatio: readableChars > 0 ? summaryChars / readableChars : 0 }), attribution, reviewFlags: [...new Set(result.chunks.flatMap((chunk) => chunk.blocks.flatMap((block) => block.reviewFlags)))].sort() };
  };
  return { baseline, single: candidate("single"), "window-3": candidate("three") };
}

export const reconciliationBenchmarkCommand = buildCommand({
  docs: { brief: "Run isolated immutable reconciliation benchmark lanes; no promotion" },
  parameters: { flags, positional: { kind: "tuple", parameters: [{ parse: parseBoundedString, brief: "Immutable canonical transcript source directory" }] } },
  async func(this: LocalContext, parsedFlags: BenchmarkFlags, source: string): Promise<void> {
    const sourceDir = resolve(this.currentPath, source);
    const trialDir = resolve(this.currentPath, parsedFlags["trial-root"]);
    const lanes = parseLanes(parsedFlags.lanes);
    const executors = createBenchmarkExecutors({
      campaign: parsedFlags.campaign,
      sessionDate: parsedFlags["session-date"],
      contextRoot: resolve(this.currentPath, parsedFlags["context-root"]),
      corrections: parsedFlags.corrections ? resolve(this.currentPath, parsedFlags.corrections) : undefined,
      profile: parsedFlags.profile,
      maxTurns: parsedFlags["max-turns"],
      timeoutMs: parsedFlags["timeout-ms"],
      promptVersion: parsedFlags["prompt-version"],
      schemaVersion: parsedFlags["schema-version"],
      repositoryCwd: this.currentPath,
    });
    const report = await runBenchmark({ sourceDir, trialDir, runId: `cli-${Date.now()}`, lanes, executors });
    this.process.stdout.write(`Benchmark ${report.runId} complete; candidates remain isolated and are not promoted.\n`);
  },
});
