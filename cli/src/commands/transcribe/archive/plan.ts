import { basename, join } from "node:path";

export interface ArchivePlan {
  sessionName: string;
  audioSource: string;
  audioEntryName: string;
  /** Legacy final transcript candidates, in public selection order. */
  legacyTranscriptCandidates: string[];
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

export function buildArchivePlan(
  options: BuildArchivePlanOptions,
): ArchivePlan {
  const sessionName = basename(options.sessionDir);
  return {
    sessionName,
    audioSource: join(options.sessionDir, "normalized", "session.flac"),
    audioEntryName: `session-audio.${options.audioExtension}`,
    legacyTranscriptCandidates: options.hasCanonicalReconciliation ? [] : [
      join(options.sessionDir, "reconciled_transcript.md"),
      join(options.sessionDir, "corrected_transcript.md"),
    ],
    zipPath: join(options.outputDir, `${sessionName}.zip`),
    unpackedDir: join(options.outputDir, sessionName),
    reconciliation: options.hasCanonicalReconciliation
      ? { kind: "canonical", directory: join(options.sessionDir, "reconciliation") }
      : { kind: "legacy" },
  };
}
