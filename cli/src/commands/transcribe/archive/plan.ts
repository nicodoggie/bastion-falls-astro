import { basename, join } from "node:path";

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
}

export interface BuildArchivePlanOptions {
  sessionDir: string;
  transcribeDir: string;
  outputDir: string;
  audioExtension: string;
}

export function buildArchivePlan(
  options: BuildArchivePlanOptions,
): ArchivePlan {
  const sessionName = basename(options.sessionDir);
  return {
    sessionName,
    audioSource: join(options.sessionDir, "normalized", "session.flac"),
    audioEntryName: `session-audio.${options.audioExtension}`,
    copies: [
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
        sourcePath: join(options.transcribeDir, "corrections.yaml"),
        entryName: "corrections.yaml",
        required: false,
      },
    ],
    zipPath: join(options.outputDir, `${sessionName}.zip`),
    unpackedDir: join(options.outputDir, sessionName),
  };
}
