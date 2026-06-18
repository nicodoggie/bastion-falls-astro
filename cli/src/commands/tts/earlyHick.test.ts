import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  buildEarlyHickMbrolaPlan,
  loadLexiconEntries,
  mbrolaSourcePaths,
  slugForLexiconEntry,
  splitEntryForPostVcGlottal,
  uniqueSlugsForLexiconEntries,
} from "./earlyHick.js";
import {
  BUILTIN_EARLY_HICK_TTS_DEFAULTS,
  resolveEarlyHickTtsDefaults,
} from "./config.js";
import {
  DEFAULT_EARLY_HICK_AUDIO_OUT_DIR,
  DEFAULT_EARLY_HICK_AUDIO_PUBLIC_OUT_DIR,
  DEFAULT_EARLY_HICK_MBROLA_PHO_DIR,
  DEFAULT_EARLY_HICK_AUDIO_WORK_DIR,
  toPublicManifestItem,
  webAudioOutputsForSlug,
} from "./impl.js";

test("plans simple Early Hick phonetics as MBROLA it2 phones with tail padding", () => {
  const plan = buildEarlyHickMbrolaPlan({
    id: "ehk:bris",
    writtenForm: "bris",
    phoneticForm: "bris",
  });

  assert.equal(plan.slug, "bris");
  assert.match(plan.pho, /^_ 30\n/);
  assert.match(plan.pho, /B 44 /);
  assert.match(plan.pho, /R 42 /);
  assert.match(plan.pho, /I 150 /);
  assert.match(plan.pho, /S 145 /);
  assert.match(plan.pho, /_ 170\n$/);
  assert.deepEqual(plan.approximations, []);
});

test("records theta, glottal, h, and schwa approximations", () => {
  const plan = buildEarlyHickMbrolaPlan({
    id: "ehk:probe",
    writtenForm: "tha'u",
    phoneticForm: "θa.ʔhu.ə",
  });

  assert.match(plan.pho, /T 58 /);
  assert.match(plan.pho, /_ 70/);
  assert.match(plan.pho, /_ 25/);
  assert.match(plan.pho, /A 74 /);
  assert.deepEqual(
    plan.approximations.map((item) => [item.symbol, item.strategy]),
    [
      ["θ", "it2:T"],
      ["ʔ", "short_pause"],
      ["h", "short_boundary"],
      ["ə", "short_low_prominence_A"],
    ],
  );
});

test("uses stronger source timing for v before a glottal split", () => {
  const plan = buildEarlyHickMbrolaPlan({
    id: "ehk:ven-er",
    writtenForm: "ven'er",
    phoneticForm: "ven.ʔer",
  });

  assert.match(plan.pho, /V 74 /);
  assert.match(plan.pho, /_ 70/);
  assert.doesNotMatch(plan.pho, /V 50 /);
});

test("splits internal glottal stops for post-VC splicing", () => {
  const split = splitEntryForPostVcGlottal({
    id: "ehk:ven-er",
    writtenForm: "ven'er",
    phoneticForm: "ven.ʔer",
  });

  assert.deepEqual(split?.chunks, [
    {
      id: "ehk:ven-er:glottal-1",
      writtenForm: "ven",
      phoneticForm: "ven",
    },
    {
      id: "ehk:ven-er:glottal-2",
      writtenForm: "er",
      phoneticForm: "er",
    },
  ]);
  assert.equal(split.gapMs, 35);
});

test("loads lexical entries from JSON-LD shards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bfcli-tts-"));
  const shardPath = join(dir, "sample.jsonld");
  await writeFile(
    shardPath,
    JSON.stringify({
      "@graph": [
        {
          "@id": "ehk:bar",
          "@type": ["ontolex:LexicalEntry", "lexinfo:Noun"],
          canonicalForm: {
            writtenRep: "bar",
            phoneticRep: "bar",
          },
        },
        {
          "@id": "ehk:not-entry",
          "@type": "ontolex:Form",
          canonicalForm: {
            writtenRep: "ignored",
            phoneticRep: "ignored",
          },
        },
      ],
    }),
    "utf8",
  );

  const entries = await loadLexiconEntries([shardPath]);
  assert.deepEqual(entries, [
    { id: "ehk:bar", writtenForm: "bar", phoneticForm: "bar" },
  ]);
});

test("creates filesystem-safe slugs for lexical entries", () => {
  assert.equal(
    slugForLexiconEntry({
      id: "ehk:'u'u",
      writtenForm: "'u'u",
      phoneticForm: "ʔu.ʔu",
    }),
    "_u_u",
  );
  assert.equal(
    slugForLexiconEntry({
      id: "ehk:eldegralen asadimris",
      writtenForm: "eldegralen asadimris",
      phoneticForm: "el.de.gra.len a.sa.dim.ris",
    }),
    "eldegralen-asadimris",
  );
});

test("creates deterministic unique slugs when entries collide", () => {
  const slugs = uniqueSlugsForLexiconEntries([
    { id: "ehk:-is", writtenForm: "-is", phoneticForm: "is" },
    { id: "ehk:-ʔis", writtenForm: "-ʔis", phoneticForm: "ʔis" },
  ]);

  assert.equal(slugs.get("ehk:-is"), "is");
  assert.equal(slugs.get("ehk:-ʔis"), "_is");
});

test("defaults lexicon audio output to browser formats in Astro asset directories", () => {
  assert.equal(
    DEFAULT_EARLY_HICK_AUDIO_OUT_DIR,
    "astro/src/assets/languages/hickic/seneran/early-hick/audio/lexicon",
  );
  assert.equal(
    DEFAULT_EARLY_HICK_AUDIO_PUBLIC_OUT_DIR,
    "astro/public/languages/hickic/seneran/early-hick/audio/lexicon",
  );
  assert.equal(
    DEFAULT_EARLY_HICK_MBROLA_PHO_DIR,
    "astro/src/assets/languages/hickic/seneran/early-hick/audio/mbrola",
  );
  assert.equal(DEFAULT_EARLY_HICK_AUDIO_WORK_DIR, "/tmp/early-hick-tts-cli");

  assert.deepEqual(
    webAudioOutputsForSlug("/src-audio", "/public-audio", "ven_er", "cute-sample"),
    {
      primaryOutputPath: "/src-audio/ven_er.webm",
      sources: [
        {
          outputPath: "/src-audio/ven_er.webm",
          type: "audio/webm; codecs=opus",
        },
        {
          outputPath: "/src-audio/ven_er.mp3",
          type: "audio/mpeg",
        },
      ],
      publicCopies: [
        "/public-audio/ven_er.webm",
        "/public-audio/ven_er.mp3",
      ],
    },
  );
});

test("resolves Early Hick TTS defaults from bfcli config", () => {
  assert.deepEqual(resolveEarlyHickTtsDefaults({}), BUILTIN_EARLY_HICK_TTS_DEFAULTS);
  assert.deepEqual(
    resolveEarlyHickTtsDefaults({
      tts: {
        earlyHick: {
          lexiconGlob: "src/assets/languages/hickic/seneran/early-hick/lexicon/*.jsonld",
          audioOutDir: "src/assets/languages/hickic/seneran/early-hick/audio/lexicon",
          publicAudioOutDir: "public/languages/hickic/seneran/early-hick/audio/lexicon",
          mbrolaPhoDir: "src/assets/languages/hickic/seneran/early-hick/audio/mbrola",
          workDir: "/tmp/custom-early-hick",
        },
      },
    }),
    {
      lexiconGlob: "src/assets/languages/hickic/seneran/early-hick/lexicon/*.jsonld",
      audioOutDir: "src/assets/languages/hickic/seneran/early-hick/audio/lexicon",
      publicAudioOutDir: "public/languages/hickic/seneran/early-hick/audio/lexicon",
      mbrolaPhoDir: "src/assets/languages/hickic/seneran/early-hick/audio/mbrola",
      workDir: "/tmp/custom-early-hick",
    },
  );
});

test("writes committed MBROLA pho files separately from scratch WAV files", () => {
  assert.deepEqual(mbrolaSourcePaths("/tmp/early-hick-tts-cli", "/repo/astro/src/audio/mbrola", "ven_er"), {
    pho: "/repo/astro/src/audio/mbrola/ven_er.pho",
    wav: "/tmp/early-hick-tts-cli/mbrola/wav/ven_er.wav",
  });
});

test("sanitizes public manifest entries to browser audio paths", () => {
  const manifestItem = toPublicManifestItem({
    id: "ehk:ven-er",
    slug: "ven_er",
    writtenForm: "ven'er",
    phoneticForm: "ven.ʔer",
    approximations: [],
    unsupported: [],
    status: "generated",
    phoPath: "/tmp/early-hick-tts-cli/mbrola/pho/ven_er.pho",
    mbrolaSourcePath: "/tmp/early-hick-tts-cli/mbrola/wav/ven_er.wav",
    workingOutputPath: "/tmp/early-hick-tts-cli/vc/cute-sample/ven_er.wav",
    outputPath: "/repo/astro/src/assets/languages/hickic/seneran/early-hick/audio/lexicon/ven_er.webm",
    sources: [
      {
        outputPath:
          "/repo/astro/src/assets/languages/hickic/seneran/early-hick/audio/lexicon/ven_er.webm",
        type: "audio/webm; codecs=opus",
      },
      {
        outputPath:
          "/repo/astro/src/assets/languages/hickic/seneran/early-hick/audio/lexicon/ven_er.mp3",
        type: "audio/mpeg",
      },
    ],
    postVcGlottal: {
      gapMs: 35,
      chunks: [
        {
          writtenForm: "ven",
          phoneticForm: "ven",
          mbrolaSourcePath: "/tmp/early-hick-tts-cli/mbrola/wav-chunks/ven_er/1-ven.wav",
          outputPath: "/tmp/early-hick-tts-cli/vc-chunks/cute-sample/ven_er/1-ven.wav",
        },
      ],
    },
  });

  assert.equal(manifestItem.outputPath, "ven_er.webm");
  assert.deepEqual(manifestItem.sources, [
    {
      outputPath: "ven_er.webm",
      type: "audio/webm; codecs=opus",
    },
    {
      outputPath: "ven_er.mp3",
      type: "audio/mpeg",
    },
  ]);
  assert.deepEqual(manifestItem.postVcGlottal, {
    gapMs: 35,
    chunks: [
      {
        writtenForm: "ven",
        phoneticForm: "ven",
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(manifestItem), /cute-sample|it2-tail|\.wav/);
});
