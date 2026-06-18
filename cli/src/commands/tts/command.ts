import { buildCommand, buildRouteMap, numberParser, type FlagParametersForType } from "@stricli/core";

import type { LocalContext } from "@/context.js";
import {
  DEFAULT_EARLY_HICK_AUDIO_OUT_DIR,
  DEFAULT_EARLY_HICK_AUDIO_PUBLIC_OUT_DIR,
  DEFAULT_EARLY_HICK_AUDIO_WORK_DIR,
} from "./impl.js";

interface TtsLexiconFlags {
  "lexicon-glob": string;
  out: string;
  "public-out": string;
  "work-dir": string;
  ids?: string;
  limit?: number;
  "reference-audio": string;
  voice: string;
  "chatterbox-python": string;
  "mbrola-db": string;
  device: string;
  force?: boolean;
  "skip-vc"?: boolean;
}

const flags: FlagParametersForType<TtsLexiconFlags, LocalContext> = {
  "lexicon-glob": {
    kind: "parsed",
    parse: String,
    brief: "Glob for source lexicon JSON-LD shards",
    default: "astro/src/assets/languages/hickic/seneran/early-hick/lexicon/*.jsonld",
  },
  out: {
    kind: "parsed",
    parse: String,
    brief: "Output directory for final browser audio and the TTS manifest",
    default: DEFAULT_EARLY_HICK_AUDIO_OUT_DIR,
  },
  "public-out": {
    kind: "parsed",
    parse: String,
    brief: "Astro public directory to mirror final browser audio into",
    default: DEFAULT_EARLY_HICK_AUDIO_PUBLIC_OUT_DIR,
  },
  "work-dir": {
    kind: "parsed",
    parse: String,
    brief: "Scratch directory for MBROLA, Chatterbox, and intermediate WAV files",
    default: DEFAULT_EARLY_HICK_AUDIO_WORK_DIR,
  },
  ids: {
    kind: "parsed",
    parse: String,
    brief: "Comma-separated entry ids, written forms, or generated slugs to process",
    optional: true,
  },
  limit: {
    kind: "parsed",
    parse: numberParser,
    brief: "Limit the number of selected entries",
    optional: true,
  },
  "reference-audio": {
    kind: "parsed",
    parse: String,
    brief: "Reference voice audio for Chatterbox VC",
    default: "/home/ensu/Projects/sml/runpod-tts-api/ref_audio/sample.mp3",
  },
  voice: {
    kind: "parsed",
    parse: String,
    brief: "Stable voice label used in output filenames and manifests",
    default: "cute-sample",
  },
  "chatterbox-python": {
    kind: "parsed",
    parse: String,
    brief: "Python executable in a venv with chatterbox installed",
    default: "/tmp/bf-chatterbox-venv/bin/python",
  },
  "mbrola-db": {
    kind: "parsed",
    parse: String,
    brief: "MBROLA database path",
    default: "/usr/share/mbrola/it2/it2",
  },
  device: {
    kind: "parsed",
    parse: String,
    brief: "Chatterbox device: auto, cuda, or cpu",
    default: "auto",
  },
  force: {
    kind: "boolean",
    brief: "Overwrite existing generated WAV files",
    optional: true,
  },
  "skip-vc": {
    kind: "boolean",
    brief: "Only generate MBROLA source audio; skip Chatterbox voice conversion",
    optional: true,
  },
};

const lexiconCommand = buildCommand({
  loader: async () => await import("./impl.js"),
  parameters: {
    flags,
  },
  docs: {
    brief: "Generate Early Hick lexical audio samples",
  },
});

export const ttsCommandRoutes = buildRouteMap({
  routes: {
    lexicon: lexiconCommand,
    "early-hick": lexiconCommand,
  },
  defaultCommand: "lexicon",
  docs: {
    brief: "Text-to-speech and lexical audio utilities",
  },
});
