import { resolve } from "node:path";

export const DEFAULT_TRANSCRIBE_DIRNAME = ".bf-transcripts";
export const DEFAULT_OUTPUT_DIRNAME = ".bf-archives";
export const DEFAULT_AUDIO_BITRATE = "32k";

export interface RawArchiveConfig {
  transcribeDir?: string;
  outputDir?: string;
  compression?: boolean;
  audioBitrate?: string;
}

export interface ArchiveOverrides {
  transcribeDir?: string;
  outputDir?: string;
  compression?: boolean;
  bitrate?: string;
}

export interface ResolvedArchiveSettings {
  transcribeDir: string;
  outputDir: string;
  compression: boolean;
  audioBitrate: string;
}

export function resolveArchiveSettings(
  baseDir: string,
  config: RawArchiveConfig,
  overrides: ArchiveOverrides = {},
): ResolvedArchiveSettings {
  return {
    transcribeDir: resolve(
      baseDir,
      overrides.transcribeDir ??
        config.transcribeDir ??
        DEFAULT_TRANSCRIBE_DIRNAME,
    ),
    outputDir: resolve(
      baseDir,
      overrides.outputDir ?? config.outputDir ?? DEFAULT_OUTPUT_DIRNAME,
    ),
    compression: overrides.compression ?? config.compression ?? true,
    audioBitrate:
      overrides.bitrate ?? config.audioBitrate ?? DEFAULT_AUDIO_BITRATE,
  };
}
