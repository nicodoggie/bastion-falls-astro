export interface EarlyHickTtsDefaults {
  lexiconGlob: string;
  audioOutDir: string;
  publicAudioOutDir: string;
  mbrolaPhoDir: string;
  workDir: string;
}

export const BUILTIN_EARLY_HICK_TTS_DEFAULTS: EarlyHickTtsDefaults = {
  lexiconGlob: "astro/src/assets/languages/hickic/seneran/early-hick/lexicon/*.jsonld",
  audioOutDir: "astro/src/assets/languages/hickic/seneran/early-hick/audio/lexicon",
  publicAudioOutDir: "astro/public/languages/hickic/seneran/early-hick/audio/lexicon",
  mbrolaPhoDir: "astro/src/assets/languages/hickic/seneran/early-hick/audio/mbrola",
  workDir: "/tmp/early-hick-tts-cli",
};

export function resolveEarlyHickTtsDefaults(config: unknown): EarlyHickTtsDefaults {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return BUILTIN_EARLY_HICK_TTS_DEFAULTS;
  }

  const tts = readObject((config as Record<string, unknown>)["tts"]);
  const earlyHick = readObject(tts?.["earlyHick"]);

  return {
    lexiconGlob: readString(earlyHick?.["lexiconGlob"]) ?? BUILTIN_EARLY_HICK_TTS_DEFAULTS.lexiconGlob,
    audioOutDir: readString(earlyHick?.["audioOutDir"]) ?? BUILTIN_EARLY_HICK_TTS_DEFAULTS.audioOutDir,
    publicAudioOutDir:
      readString(earlyHick?.["publicAudioOutDir"]) ??
      BUILTIN_EARLY_HICK_TTS_DEFAULTS.publicAudioOutDir,
    mbrolaPhoDir:
      readString(earlyHick?.["mbrolaPhoDir"]) ?? BUILTIN_EARLY_HICK_TTS_DEFAULTS.mbrolaPhoDir,
    workDir: readString(earlyHick?.["workDir"]) ?? BUILTIN_EARLY_HICK_TTS_DEFAULTS.workDir,
  };
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
