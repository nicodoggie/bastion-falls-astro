import { access, lstat, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export interface ArchiveSourceFile {
  sourcePath: string;
  entryName: string;
  required: boolean;
}

export interface ArchivePlan {
  sessionName: string;
  audioSource: string;
  audioEntryName: string;
  copies: ArchiveSourceFile[];
  zipPath: string;
  unpackedDir: string;
  reconciliation: {
    kind: "legacy" | "canonical";
    directory?: string;
  };
}

export interface BuildArchivePlanOptions {
  sessionDir: string;
  transcribeDir: string;
  outputDir: string;
  audioExtension: string;
  hasCanonicalReconciliation?: boolean;
}

const PROVENANCE_EXTENSIONS = new Set([".json", ".md", ".yml", ".yaml"]);
const PROVENANCE_DIRECTORIES = ["raw_chunks", "raw_transcription"];

function isSafeRelativePath(path: string): boolean {
  return path !== "" && !isAbsolute(path) && !path.split(/[\\/]/).includes("..");
}

/** Collect bounded, authored provenance without traversing archive-unsafe paths. */
export async function collectArchiveSources(
  sessionDir: string,
): Promise<ArchiveSourceFile[]> {
  const root = await realpath(resolve(sessionDir));
  const result: ArchiveSourceFile[] = [];
  const add = async (candidatePath: string, entryName: string): Promise<void> => {
    const extension = entryName.slice(entryName.lastIndexOf(".")).toLowerCase();
    if (!isSafeRelativePath(entryName) || !PROVENANCE_EXTENSIONS.has(extension)) return;
    const stats = await lstat(candidatePath);
    if (!stats.isFile() || stats.isSymbolicLink()) return;
    const sourcePath = await realpath(candidatePath);
    const fromRoot = relative(root, sourcePath);
    if (!isSafeRelativePath(fromRoot)) return;
    result.push({ sourcePath, entryName, required: false });
  };
  for (const name of ["manifest.json", "checkpoint.json", "channel-map.yml"]) {
    try {
      await access(join(root, name));
      await add(join(root, name), name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  async function visit(directory: string, prefix: string): Promise<void> {
    const directoryStats = await lstat(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) return;
    const resolvedDirectory = await realpath(directory);
    if (!isSafeRelativePath(relative(root, resolvedDirectory))) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relativeName = `${prefix}/${entry.name}`;
      if (!isSafeRelativePath(relativeName)) continue;
      const sourcePath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(sourcePath, relativeName);
      else if (entry.isFile()) await add(sourcePath, relativeName);
    }
  }
  for (const directory of PROVENANCE_DIRECTORIES) {
    try {
      await visit(join(root, directory), directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return result;
}

export function buildArchivePlan(
  options: BuildArchivePlanOptions,
): ArchivePlan {
  const sessionName = basename(options.sessionDir);
  const correctionsCopy = {
    sourcePath: join(options.transcribeDir, "corrections.yaml"),
    entryName: "corrections.yaml",
    required: false,
  };
  return {
    sessionName,
    audioSource: join(options.sessionDir, "normalized", "session.flac"),
    audioEntryName: `session-audio.${options.audioExtension}`,
    copies: options.hasCanonicalReconciliation ? [correctionsCopy] : [
      {
        sourcePath: join(options.sessionDir, "raw_transcript.md"),
        entryName: "raw_transcript.md",
        required: true,
      },
      {
        sourcePath: join(options.sessionDir, "corrected_transcript.md"),
        entryName: "corrected_transcript.md",
        required: false,
      },
      {
        sourcePath: join(options.sessionDir, "correction_notes.md"),
        entryName: "correction_notes.md",
        required: false,
      },
      {
        sourcePath: join(options.sessionDir, "reconciled_transcript.md"),
        entryName: "reconciled_transcript.md",
        required: false,
      },
      {
        sourcePath: join(options.sessionDir, "hermes_review_notes.md"),
        entryName: "hermes_review_notes.md",
        required: false,
      },
      correctionsCopy,
      ...["manifest.json", "checkpoint.json", "channel-map.yml"].map((name) => ({
        sourcePath: join(options.sessionDir, name),
        entryName: name,
        required: false,
      })),
    ],
    zipPath: join(options.outputDir, `${sessionName}.zip`),
    unpackedDir: join(options.outputDir, sessionName),
    reconciliation: options.hasCanonicalReconciliation
      ? { kind: "canonical", directory: join(options.sessionDir, "reconciliation") }
      : { kind: "legacy" },
  };
}
