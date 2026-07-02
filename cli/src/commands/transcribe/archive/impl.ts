import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { getConfigBaseDir, getTranscribeConfig } from "@/config.js";
import type { LocalContext } from "@/context.js";
import {
  type ArchiveAllResult,
  formatArchiveSummary,
  isExistingOutputSkip,
} from "./bulk.js";
import { encodeToOpus } from "./encode.js";
import { type ArchiveSourceFile, buildArchivePlan } from "./plan.js";
import type { ResolvedArchiveSettings } from "./settings.js";
import { type RawArchiveConfig, resolveArchiveSettings } from "./settings.js";
import { createZipArchive, type ZipEntry } from "./zip.js";

const AUDIO_EXTENSION = "opus";

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

async function listSessionDirectories(
  transcribeDir: string,
): Promise<string[]> {
  const entries = await readdir(transcribeDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

interface ArchiveSessionOptions {
  context: LocalContext;
  cwd: string;
  settings: ResolvedArchiveSettings;
  flags: ArchiveFlags;
  session: string;
}

async function archiveSession(options: ArchiveSessionOptions): Promise<string> {
  const { context, cwd, flags, session, settings } = options;
  const sessionDir = await resolveSessionDir(
    cwd,
    settings.transcribeDir,
    session,
  );
  const plan = buildArchivePlan({
    sessionDir,
    transcribeDir: settings.transcribeDir,
    outputDir: settings.outputDir,
    audioExtension: AUDIO_EXTENSION,
  });

  if (!(await pathExists(plan.audioSource))) {
    throw new Error(`Missing required audio at ${plan.audioSource}.`);
  }

  const includedCopies: ArchiveSourceFile[] = [];
  for (const copy of plan.copies) {
    if (await pathExists(copy.sourcePath)) {
      includedCopies.push(copy);
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

  try {
    context.process.stdout.write(
      `Encoding ${plan.audioSource} → ${plan.audioEntryName}\n`,
    );
    await encodeToOpus({
      input: plan.audioSource,
      output: tempAudio,
      bitrate: settings.audioBitrate,
      force: true,
      progress: context.process.stdout,
    });

    if (settings.compression) {
      const entries: ZipEntry[] = [
        { path: tempAudio, name: plan.audioEntryName },
        ...includedCopies.map((copy) => ({
          path: copy.sourcePath,
          name: copy.entryName,
        })),
      ];
      await createZipArchive(entries, tempDestination);
      if (flags.force) {
        await rm(destination, { recursive: true, force: true });
      }
      await rename(tempDestination, plan.zipPath);
      context.process.stdout.write(`Wrote archive ${plan.zipPath}\n`);
      return plan.zipPath;
    }

    await mkdir(tempDestination, { recursive: true });
    await copyFile(tempAudio, join(tempDestination, plan.audioEntryName));
    for (const copy of includedCopies) {
      await copyFile(copy.sourcePath, join(tempDestination, copy.entryName));
    }
    if (flags.force) {
      await rm(destination, { recursive: true, force: true });
    }
    await rename(tempDestination, plan.unpackedDir);
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
