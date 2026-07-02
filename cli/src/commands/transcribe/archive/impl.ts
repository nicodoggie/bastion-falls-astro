import { access, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { getConfigBaseDir, getTranscribeConfig } from "@/config.js";
import type { LocalContext } from "@/context.js";
import { encodeToOpus } from "./encode.js";
import { type ArchiveSourceFile, buildArchivePlan } from "./plan.js";
import { type RawArchiveConfig, resolveArchiveSettings } from "./settings.js";
import { createZipArchive, type ZipEntry } from "./zip.js";

const AUDIO_EXTENSION = "opus";

export interface ArchiveFlags {
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

export default async function archive(
  this: LocalContext,
  flags: ArchiveFlags,
  session: string,
): Promise<void> {
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
      (this.process.stderr ?? this.process.stdout).write(
        `Warning: Skipping missing ${copy.entryName} (${copy.sourcePath})\n`,
      );
    }
  }

  const destination = settings.compression ? plan.zipPath : plan.unpackedDir;
  if (await pathExists(destination)) {
    if (!flags.force) {
      throw new Error(
        `${destination} already exists. Pass --force to overwrite it.`,
      );
    }
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
    this.process.stdout.write(
      `Encoding ${plan.audioSource} → ${plan.audioEntryName}\n`,
    );
    await encodeToOpus({
      input: plan.audioSource,
      output: tempAudio,
      bitrate: settings.audioBitrate,
      force: true,
      progress: this.process.stdout,
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
      this.process.stdout.write(`Wrote archive ${plan.zipPath}\n`);
    } else {
      await mkdir(tempDestination, { recursive: true });
      await copyFile(tempAudio, join(tempDestination, plan.audioEntryName));
      for (const copy of includedCopies) {
        await copyFile(copy.sourcePath, join(tempDestination, copy.entryName));
      }
      if (flags.force) {
        await rm(destination, { recursive: true, force: true });
      }
      await rename(tempDestination, plan.unpackedDir);
      this.process.stdout.write(
        `Wrote archive contents to ${plan.unpackedDir}\n`,
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await rm(tempDestination, { recursive: true, force: true });
  }
}
