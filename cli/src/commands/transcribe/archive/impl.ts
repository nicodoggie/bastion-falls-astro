import {
  access,
  constants,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import { getConfigBaseDir, getTranscribeConfig } from "../../../config.js";
import type { LocalContext } from "../../../context.js";
import {
  type ArchiveAllResult,
  formatArchiveSummary,
  isExistingOutputSkip,
} from "./bulk.js";
import { encodeToOpus } from "./encode.js";
import {
  type ArchiveSourceFile,
  buildArchivePlan,
  collectArchiveSources,
} from "./plan.js";
import type { ResolvedArchiveSettings } from "./settings.js";
import { type RawArchiveConfig, resolveArchiveSettings } from "./settings.js";
import { createZipArchive, type ZipEntry } from "./zip.js";
import { selectOwnedAlignmentEvents } from "../reconciliationEvidence.js";
import { isAlignmentArtifactName, parseAlignmentResult } from "../alignment.js";
import { ChunkWindowSchema, parseCanonicalReconciliation, type CanonicalReconciliation, type SourceEvent } from "../reconciliation.js";
import { renderPublicReconciliation } from "../reconciliationRender.js";
import { parsePrivateRedactionsYaml, PRIVATE_REDACTIONS_FILENAME, PUBLIC_PRIVACY_RECEIPT_FILENAME, serializePublicPrivacyReceipt, timestampToSeconds, type PrivateRedactions } from "./privacy.js";
import { findUnsafePublicSpeakerLabels, redactTranscript } from "./transcriptRedaction.js";
import { getAudioDurationSeconds } from "../audio.js";
import { runCommand } from "../process.js";

const AUDIO_EXTENSION = "opus";
const MAX_PROJECTION_INPUT_BYTES = 20_000_000;

export interface ArchiveFlags {
  all?: boolean;
  compression?: boolean;
  "output-dir"?: string;
  "transcribe-dir"?: string;
  bitrate?: string;
  force?: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function openSafeSessionDirectory(sessionDir: string, candidate: string) {
  const original = await lstat(candidate);
  if (!original.isDirectory() || original.isSymbolicLink()) throw new Error(`Archive projection directory is unsafe: ${candidate}`);
  const handle = await open(candidate, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isDirectory() || opened.dev !== original.dev || opened.ino !== original.ino) {
      throw new Error(`Archive projection directory changed during validation: ${candidate}`);
    }
    const [root, resolved] = await Promise.all([realpath(sessionDir), realpath(`/proc/self/fd/${handle.fd}`)]);
    if (!isContained(root, resolved)) throw new Error(`Archive projection directory escapes its session root: ${candidate}`);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readSafeSessionText(sessionDir: string, candidate: string): Promise<string> {
  const original = await lstat(candidate);
  if (!original.isFile() || original.isSymbolicLink()) throw new Error(`Archive projection input is not a regular file: ${candidate}`);
  if (original.size > MAX_PROJECTION_INPUT_BYTES) throw new Error(`Archive projection input exceeds its byte bound: ${candidate}`);
  const [root, resolved] = await Promise.all([realpath(sessionDir), realpath(candidate)]);
  if (!isContained(root, resolved)) throw new Error(`Archive projection input escapes its session root: ${candidate}`);
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== original.dev || opened.ino !== original.ino || opened.size !== original.size) {
      throw new Error(`Archive projection input changed during validation: ${candidate}`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const remaining = MAX_PROJECTION_INPUT_BYTES + 1 - total;
      if (remaining <= 0) throw new Error(`Archive projection input exceeds its byte bound: ${candidate}`);
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_PROJECTION_INPUT_BYTES) throw new Error(`Archive projection input exceeds its byte bound: ${candidate}`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error(`Archive projection input changed while reading: ${candidate}`);
    }
    return text;
  } finally {
    await handle.close();
  }
}

async function readReviewedRedactions(sessionDir: string): Promise<PrivateRedactions> {
  const manifestPath = join(sessionDir, PRIVATE_REDACTIONS_FILENAME);
  try { return parsePrivateRedactionsYaml(await readSafeSessionText(sessionDir, manifestPath)); }
  catch (error) { throw new Error(`Missing required reviewed ${PRIVATE_REDACTIONS_FILENAME}: ${errorMessage(error)}`); }
}

function number(value: number): string { return Number(value.toFixed(6)).toString(); }
function escaped(expression: string): string { return expression.replaceAll(",", "\\,"); }

export function buildAudioRedactionArgs(input: string, output: string, rules: PrivateRedactions["audio"], durationSeconds: number): string[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Audio duration must be finite and positive");
  const ordered = [...rules].sort((left, right) => timestampToSeconds(left.start) - timestampToSeconds(right.start));
  let previousEnd = -Infinity;
  const filters = ordered.map((rule) => {
    const start = timestampToSeconds(rule.start), end = timestampToSeconds(rule.end), fade = rule.fadeMilliseconds / 1_000;
    if (end > durationSeconds) throw new Error("Audio redaction interval exceeds source duration");
    if (start < previousEnd) throw new Error("Audio redaction intervals must not overlap");
    previousEnd = end;
    const gain = fade === 0
      ? `if(between(t,${number(start)},${number(end)}),0,1)`
      : `if(lt(t,${number(Math.max(0, start - fade))}),1,if(lt(t,${number(start)}),(${number(start)}-t)/${number(fade)},if(lt(t,${number(end)}),0,if(lt(t,${number(end + fade)}),(t-${number(end)})/${number(fade)},1))))`;
    return `volume='${escaped(gain)}':eval=frame`;
  });
  return ["-hide_banner", "-nostats", "-y", "-i", input, "-vn", ...(filters.length ? ["-filter:a", filters.join(",")] : []), "-c:a", "flac", output];
}

async function applyAudioRedactions(input: string, output: string, rules: PrivateRedactions["audio"]): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  const durationSeconds = await getAudioDurationSeconds(input);
  await runCommand("ffmpeg", buildAudioRedactionArgs(input, output, rules, durationSeconds));
}

export async function readStructuredPublicProjection(sessionDir: string, reconciliationDir: string, reviewedManifest?: PrivateRedactions): Promise<string> {
  const reconciliationHandle = await openSafeSessionDirectory(sessionDir, reconciliationDir);
  try {
    const reconciliationRoot = `/proc/self/fd/${reconciliationHandle.fd}`;
    const names = (await readdir(reconciliationRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^session_\d{3}\.json$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    if (names.length === 0) throw new Error(`Canonical reconciliation directory is empty: ${reconciliationDir}`);

    const alignmentDir = join(sessionDir, "raw_transcription", "alignment");
    const alignmentHandle = await openSafeSessionDirectory(sessionDir, alignmentDir);
    try {
      const alignmentRoot = `/proc/self/fd/${alignmentHandle.fd}`;
      let combinedAlignment: ReturnType<typeof parseAlignmentResult>;
      try {
        const alignmentNames = (await readdir(alignmentRoot, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && isAlignmentArtifactName(entry.name))
          .map((entry) => entry.name)
          .sort((left, right) => left.localeCompare(right));
        if (alignmentNames.length === 0) throw new Error("alignment directory is empty");
        const alignments = await Promise.all(alignmentNames.map(async (name) =>
          parseAlignmentResult(JSON.parse(await readSafeSessionText(sessionDir, join(alignmentRoot, name))) as unknown)
        ));
        combinedAlignment = parseAlignmentResult({ version: 1, events: alignments.flatMap((alignment) => alignment.events) });
      } catch (error) {
        throw new Error(`Missing or malformed authoritative alignment evidence: ${errorMessage(error)}`);
      }

      const chunks: CanonicalReconciliation[] = [];
      for (const name of names) {
        const chunkId = name.slice(0, -5);
        const chunkIndex = Number(chunkId.slice("session_".length));
        let value: unknown;
        try { value = JSON.parse(await readSafeSessionText(sessionDir, join(reconciliationRoot, name))) as unknown; }
        catch (error) { throw new Error(`Malformed canonical reconciliation ${name}: ${errorMessage(error)}`); }
        const window = ChunkWindowSchema.parse((value as Record<string, unknown>)["chunk"]);
        const windowAlignment = parseAlignmentResult({ version: 1, events: combinedAlignment.events.filter((event) => {
          const midpoint = (event.globalStart + event.globalEnd) / 2;
          return midpoint >= window.start && midpoint < window.end;
        }) });
        const authoritativeSourceEvents: SourceEvent[] = selectOwnedAlignmentEvents(
          windowAlignment,
          chunkIndex,
          window.start,
          window.end,
        ).map(({ id, text, start, end, confidence, supportedRange }) => ({
          id, text, start, end,
          ...(confidence === undefined ? {} : { confidence }),
          ...(supportedRange === undefined ? {} : { supportedRange }),
        }));
        const chunk = parseCanonicalReconciliation(value, { authoritativeSourceEvents });
        if (chunk.chunk.id !== chunkId) throw new Error(`Canonical artifact ${name} echoes ${chunk.chunk.id}`);
        if (chunk.summarySafety.status === "pending") throw new Error(`Canonical artifact ${name} has pending summary safety`);
        chunks.push(chunk);
      }

      const manifest = reviewedManifest ?? await readReviewedRedactions(sessionDir);
      const projected = renderPublicReconciliation(chunks);
      const redacted = redactTranscript(projected, manifest);
      const unsafeLabels = findUnsafePublicSpeakerLabels(redacted.text);
      if (unsafeLabels.length > 0) throw new Error(`Unsafe public speaker label remains at line ${unsafeLabels[0]!.line}`);
      if (/\[(?:channel|character|kind|block|source|review|chunk):/iu.test(redacted.text)) {
        throw new Error("Unsafe private structural marker remains in public reconciliation");
      }
      return redacted.text;
    } finally {
      await alignmentHandle.close();
    }
  } finally {
    await reconciliationHandle.close();
  }
}

async function resolveSessionDir(
  cwd: string,
  transcribeDir: string,
  session: string,
): Promise<string> {
  const candidates = [resolve(cwd, session), resolve(transcribeDir, session)];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Could not find session "${session}" (looked in ${candidates.join(" and ")}).`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && !isAbsolute(fromRoot) && !fromRoot.split(/[\\/]/).includes("..");
}

async function snapshotRegularFile(sourcePath: string, allowedRoot: string, destinationPath: string): Promise<void> {
  const original = await lstat(sourcePath);
  if (!original.isFile() || original.isSymbolicLink()) throw new Error(`Archive source is not a regular file: ${sourcePath}`);
  const [root, source] = await Promise.all([realpath(allowedRoot), realpath(sourcePath)]);
  if (!isContained(root, source)) throw new Error(`Archive source escapes its allowed root: ${sourcePath}`);
  const handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== original.dev || opened.ino !== original.ino) throw new Error(`Archive source changed during validation: ${sourcePath}`);
    await mkdir(dirname(destinationPath), { recursive: true });
    await pipeline(handle.createReadStream({ autoClose: false }), createWriteStream(destinationPath, { flags: "wx" }));
  } finally {
    await handle.close();
  }
}

async function publishReplacement(tempPath: string, destination: string, force: boolean): Promise<void> {
  if (!force) {
    await rename(tempPath, destination);
    return;
  }
  const backup = `${destination}.backup-${process.pid}-${Date.now()}`;
  let backedUp = false;
  try {
    try {
      await rename(destination, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(tempPath, destination);
    if (backedUp) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (backedUp && !(await pathExists(destination))) await rename(backup, destination);
    throw error;
  }
}

async function listSessionDirectories(
  transcribeDir: string,
): Promise<string[]> {
  const entries = await readdir(transcribeDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export interface ArchiveSessionDependencies {
  encodeToOpus: typeof encodeToOpus;
  createZipArchive: typeof createZipArchive;
  applyAudioRedactions: typeof applyAudioRedactions;
}

export interface ArchiveSessionOptions {
  context: LocalContext;
  cwd: string;
  settings: ResolvedArchiveSettings;
  flags: ArchiveFlags;
  session: string;
  dependencies?: Partial<ArchiveSessionDependencies>;
}

export async function archiveSession(options: ArchiveSessionOptions): Promise<string> {
  const { context, cwd, flags, session, settings } = options;
  const dependencies: ArchiveSessionDependencies = {
    encodeToOpus,
    createZipArchive,
    applyAudioRedactions,
    ...options.dependencies,
  };
  const sessionDir = await resolveSessionDir(
    cwd,
    settings.transcribeDir,
    session,
  );
  const hasCanonicalReconciliation = await pathExists(join(sessionDir, "reconciliation"));
  const plan = buildArchivePlan({
    sessionDir,
    transcribeDir: settings.transcribeDir,
    outputDir: settings.outputDir,
    audioExtension: AUDIO_EXTENSION,
    hasCanonicalReconciliation,
  });

  if (!(await pathExists(plan.audioSource))) {
    throw new Error(`Missing required audio at ${plan.audioSource}.`);
  }

  const reviewedManifest = await readReviewedRedactions(sessionDir);
  const publicProjection = plan.reconciliation.kind === "canonical"
    ? await readStructuredPublicProjection(sessionDir, plan.reconciliation.directory!, reviewedManifest)
    : undefined;

  const includedCopies: ArchiveSourceFile[] = plan.reconciliation.kind === "canonical"
    ? []
    : await collectArchiveSources(sessionDir);
  const validatedProvenanceNames = new Set(["manifest.json", "checkpoint.json", "channel-map.yml"]);
  for (const copy of plan.copies) {
    if (plan.reconciliation.kind === "canonical" && copy.entryName === "reconciled_transcript.md") continue;
    if (validatedProvenanceNames.has(copy.entryName)) continue;
    if (await pathExists(copy.sourcePath)) {
      if (!includedCopies.some((source) => source.entryName === copy.entryName)) includedCopies.push(copy);
    } else if (copy.required) {
      throw new Error(`Missing required file ${copy.sourcePath}.`);
    } else {
      (context.process.stderr ?? context.process.stdout).write(
        `Warning: Skipping missing ${copy.entryName} (${copy.sourcePath})\n`,
      );
    }
  }

  const destination = settings.compression ? plan.zipPath : plan.unpackedDir;
  if ((await pathExists(destination)) && !flags.force) {
    throw new Error(
      `${destination} already exists. Pass --force to overwrite it.`,
    );
  }

  const tempDir = await mkdtemp(join(tmpdir(), "bf-archive-"));
  const snapshotAudio = join(tempDir, "sources", "session.flac");
  const redactedAudio = join(tempDir, "sources", "session-redacted.flac");
  const tempAudio = join(tempDir, plan.audioEntryName);
  const tempDestination = settings.compression
    ? join(
        dirname(plan.zipPath),
        `.${plan.sessionName}.zip.tmp-${process.pid}-${Date.now()}`,
      )
    : join(
        dirname(plan.unpackedDir),
        `.${plan.sessionName}.tmp-${process.pid}-${Date.now()}`,
      );

  const generatedPublicPath = join(tempDir, "generated", "reconciled_transcript.md");
  const generatedReceiptPath = join(tempDir, "generated", PUBLIC_PRIVACY_RECEIPT_FILENAME);

  try {
    if (publicProjection !== undefined) {
      await mkdir(dirname(generatedPublicPath), { recursive: true });
      await writeFile(generatedPublicPath, publicProjection, "utf8");
      await writeFile(generatedReceiptPath, serializePublicPrivacyReceipt({
        version: 1,
        reviewed: true,
        policy: "transcript-archive-privacy-v1",
        audioRedactionsApplied: reviewedManifest.audio.length,
        transcriptRedactionsApplied: reviewedManifest.transcripts.length,
        speakerLabels: reviewedManifest.speakerLabels === "neutralize" ? "neutralized" : "preserved",
      }), "utf8");
    }
    await snapshotRegularFile(plan.audioSource, sessionDir, snapshotAudio);
    const publicAudioInput = reviewedManifest.audio.length > 0 ? redactedAudio : snapshotAudio;
    if (reviewedManifest.audio.length > 0) {
      await dependencies.applyAudioRedactions(snapshotAudio, redactedAudio, reviewedManifest.audio);
    }
    const snapshots: ArchiveSourceFile[] = publicProjection === undefined
      ? []
      : [
          { sourcePath: generatedPublicPath, entryName: "reconciled_transcript.md", required: true },
          { sourcePath: generatedReceiptPath, entryName: PUBLIC_PRIVACY_RECEIPT_FILENAME, required: true },
        ];
    for (const copy of includedCopies) {
      const snapshot = join(tempDir, "copies", copy.entryName);
      const allowedRoot = copy.entryName === "corrections.yaml" ? settings.transcribeDir : sessionDir;
      try {
        await snapshotRegularFile(copy.sourcePath, allowedRoot, snapshot);
        snapshots.push({ ...copy, sourcePath: snapshot });
      } catch (error) {
        if (copy.required) throw error;
        (context.process.stderr ?? context.process.stdout).write(
          `Warning: Skipping unsafe ${copy.entryName}: ${errorMessage(error)}\n`,
        );
      }
    }
    context.process.stdout.write(
      `Encoding ${plan.audioSource} → ${plan.audioEntryName}\n`,
    );
    await dependencies.encodeToOpus({
      input: publicAudioInput,
      output: tempAudio,
      bitrate: settings.audioBitrate,
      force: true,
      progress: context.process.stdout,
    });

    if (settings.compression) {
      const entries: ZipEntry[] = [
        { path: tempAudio, name: plan.audioEntryName },
        ...snapshots.map((copy) => ({
          path: copy.sourcePath,
          name: copy.entryName,
        })),
      ];
      await dependencies.createZipArchive(entries, tempDestination);
      await publishReplacement(tempDestination, plan.zipPath, Boolean(flags.force));
      context.process.stdout.write(`Wrote archive ${plan.zipPath}\n`);
      return plan.zipPath;
    }

    await mkdir(tempDestination, { recursive: true });
    await copyFile(tempAudio, join(tempDestination, plan.audioEntryName));
    for (const copy of snapshots) {
      const destinationPath = join(tempDestination, copy.entryName);
      await mkdir(dirname(destinationPath), { recursive: true });
      await copyFile(copy.sourcePath, destinationPath);
    }
    await publishReplacement(tempDestination, plan.unpackedDir, Boolean(flags.force));
    context.process.stdout.write(
      `Wrote archive contents to ${plan.unpackedDir}\n`,
    );
    return plan.unpackedDir;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await rm(tempDestination, { recursive: true, force: true });
  }
}

async function archiveAll(options: {
  context: LocalContext;
  cwd: string;
  settings: ResolvedArchiveSettings;
  flags: ArchiveFlags;
}): Promise<ArchiveAllResult[]> {
  const sessions = await listSessionDirectories(options.settings.transcribeDir);
  const results: ArchiveAllResult[] = [];

  for (const session of sessions) {
    const plan = buildArchivePlan({
      sessionDir: join(options.settings.transcribeDir, session),
      transcribeDir: options.settings.transcribeDir,
      outputDir: options.settings.outputDir,
      audioExtension: AUDIO_EXTENSION,
      hasCanonicalReconciliation: await pathExists(join(options.settings.transcribeDir, session, "reconciliation")),
    });
    const destination = options.settings.compression
      ? plan.zipPath
      : plan.unpackedDir;
    if (
      isExistingOutputSkip({
        all: true,
        force: options.flags.force,
        destinationExists: await pathExists(destination),
      })
    ) {
      options.context.process.stdout.write(
        `Skipping ${session}: output already exists at ${destination}\n`,
      );
      results.push({ status: "skipped", session, destination });
      continue;
    }

    options.context.process.stdout.write(`\nArchiving ${session}\n`);
    try {
      const archivedDestination = await archiveSession({
        context: options.context,
        cwd: options.cwd,
        settings: options.settings,
        flags: options.flags,
        session: join(options.settings.transcribeDir, session),
      });
      results.push({
        status: "archived",
        session,
        destination: archivedDestination,
      });
    } catch (error) {
      const message = errorMessage(error);
      options.context.process.stderr.write(
        `Failed to archive ${session}: ${message}\n`,
      );
      results.push({ status: "failed", session, error: message });
    }
  }

  return results;
}

export default async function archive(
  this: LocalContext,
  flags: ArchiveFlags,
  session?: string,
): Promise<void> {
  if (flags.all && session) {
    throw new Error("--all cannot be combined with a session argument.");
  }
  if (!flags.all && !session) {
    throw new Error("Session argument is required unless --all is used.");
  }

  const cwd = this.currentPath;
  const settings = resolveArchiveSettings(
    getConfigBaseDir(),
    getTranscribeConfig() as RawArchiveConfig,
    {
      compression: flags.compression,
      outputDir: flags["output-dir"],
      transcribeDir: flags["transcribe-dir"],
      bitrate: flags.bitrate,
    },
  );

  if (flags.all) {
    const results = await archiveAll({
      context: this,
      cwd,
      settings,
      flags,
    });
    this.process.stdout.write(`${formatArchiveSummary(results)}\n`);
    if (results.some((result) => result.status === "failed")) {
      this.process.exitCode = 1;
    }
    return;
  }

  await archiveSession({
    context: this,
    cwd,
    settings,
    flags,
    session: session as string,
  });
}
