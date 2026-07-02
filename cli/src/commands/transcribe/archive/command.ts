import { buildCommand } from "@stricli/core";

function parseBooleanFlag(value: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("--compression must be true or false");
}

export const archiveCommand = buildCommand({
  loader: async () => import("./impl.js"),
  parameters: {
    flags: {
      compression: {
        kind: "parsed",
        parse: parseBooleanFlag,
        brief:
          "Bundle contents into a .zip (true) or a plain directory (false); overrides config",
        optional: true,
      },
      "output-dir": {
        kind: "parsed",
        parse: String,
        brief:
          "Directory to write the archive into (overrides transcribe.outputDir)",
        optional: true,
      },
      "transcribe-dir": {
        kind: "parsed",
        parse: String,
        brief:
          "Transcripts directory holding the session and shared corrections.yaml",
        optional: true,
      },
      bitrate: {
        kind: "parsed",
        parse: String,
        brief:
          "Opus audio bitrate, e.g. 24k or 32k (overrides transcribe.audioBitrate)",
        optional: true,
      },
      all: {
        kind: "boolean",
        brief: "Archive every immediate session directory under transcribeDir",
        optional: true,
      },
      force: {
        kind: "boolean",
        brief: "Overwrite an existing archive at the destination",
        optional: true,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief:
            "Transcript session directory (a name under transcribeDir or a path)",
          optional: true,
        },
      ],
    },
  },
  docs: {
    brief:
      "Package a transcript session's audio and transcripts into a compact archive",
  },
});
