# Transcript Archive Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bfcli transcribe archive` subcommand that takes one
`.bf-transcripts` session subdirectory, re-encodes its full normalized FLAC into a
compact lossy Opus file, and bundles it with the session's transcripts and shared
corrections into a `.bf-archives` output (a `.zip` when compression is on, a plain
subdirectory when it is off).

**Architecture:** The subcommand lives inside the existing `transcribe` route map.
A thin Stricli command (`command.ts`) parses flags and a positional session
argument, then delegates to `impl.ts`, which orchestrates four small,
independently tested modules: `settings.ts` (resolve config + flag defaults),
`plan.ts` (map a session dir to source/entry file paths, pure), `encode.ts`
(ffmpeg → Opus, with a pure arg builder), and `zip.ts` (write a `.zip` via
`adm-zip`). All new files sit under `cli/src/commands/transcribe/archive/` and
reuse the sibling `transcribe/` subprocess and progress helpers. Configuration
lives under a top-level `transcribe:` object in `.bfcli.yml`.

**Tech Stack:** TypeScript (ESM, `verbatimModuleSyntax`), Stricli
(`@stricli/core`), `ffmpeg`/`ffprobe` (external binaries, already required by
`transcribe`), `adm-zip` (new dependency), `js-yaml` (already present), Node's
built-in test runner (`node --import tsx --test`).

## Global Constraints

- Language: TypeScript only for new code. Files are ESM (`"type": "module"`);
  every relative import MUST use a `.js` extension (e.g. `./plan.js`).
- `verbatimModuleSyntax` is on: import types with `import type { ... }`.
- `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature` are on:
  index-signature reads (e.g. untyped config values) must use bracket access
  (`config["transcribe"]`) and handle `undefined`.
- Path alias `@/*` maps to `cli/src/*` (e.g. `@/context.js`, `@/config.js`).
- Config file is `.bfcli.yml`, discovered by walking up from the real cwd
  (`cli/src/config.ts`). All new config lives under a single top-level
  `transcribe:` object with keys `transcribeDir`, `outputDir`, `compression`,
  `audioBitrate`:

  ```yaml
  transcribe:
    transcribeDir: .bf-transcripts
    outputDir: .bf-archives
    compression: true
    audioBitrate: 32k
  ```

- Defaults (verbatim): transcribe dir name `".bf-transcripts"`, output dir name
  `".bf-archives"`, compression `true`, audio bitrate `"32k"`, audio codec
  `libopus`, output audio extension `opus`.
- The full normalized audio in a session lives at
  `<sessionDir>/normalized/session.flac`.
- Archive contents use these exact entry names: `session-audio.opus`,
  `raw_transcript.md`, `corrected_transcript.md`, `corrections.yaml`.
- `raw_transcript.md` and `normalized/session.flac` are REQUIRED inputs (error if
  missing). `corrected_transcript.md` and `corrections.yaml` are OPTIONAL (warn
  and skip if missing).
- The shared `corrections.yaml` is `<transcribeDir>/corrections.yaml` (one file
  shared across sessions), NOT a per-session file.
- Tests use `node:test` + `node:assert/strict`, mirroring existing
  `cli/src/commands/transcribe/*.test.ts`.
- Run all commands from `cli/` unless noted. Test glob: `pnpm test` runs
  `node --import tsx --test src/**/*.test.ts`.

---

## File Structure

- `cli/src/config.ts` (modify): export `getConfigBaseDir()` (directory containing
  `.bfcli.yml`, or the real cwd) and `getTranscribeConfig()` (the top-level
  `transcribe:` object, or `{}`).
- `cli/src/commands/transcribe/archive/settings.ts` (create): pure resolution of
  config + CLI overrides into absolute paths and concrete values.
- `cli/src/commands/transcribe/archive/plan.ts` (create): pure mapping of a
  session directory + settings into the audio source and the list of files to
  include, with their in-archive entry names and required/optional flags.
- `cli/src/commands/transcribe/archive/encode.ts` (create): `buildOpusArgs()`
  (pure ffmpeg arg builder) and `encodeToOpus()` (runs ffmpeg via the shared
  `runCommand`).
- `cli/src/commands/transcribe/archive/zip.ts` (create): `createZipArchive()`
  writing a `.zip` from a list of `{ path, name }` entries via `adm-zip`.
- `cli/src/commands/transcribe/archive/impl.ts` (create): default-exported async
  handler orchestrating the above; resolves the session dir, validates inputs,
  encodes audio to a temp file, then either zips or copies into the output dir.
- `cli/src/commands/transcribe/archive/command.ts` (create): Stricli
  `buildCommand` with the flag surface and one positional (session).
- `cli/src/commands/transcribe/command.ts` (modify): import `archiveCommand` and
  add it to the `transcribeCommand` route map.
- `cli/package.json` (modify): add `adm-zip` + `@types/adm-zip`.
- Test files (create): `settings.test.ts`, `plan.test.ts`, `encode.test.ts`,
  `zip.test.ts` (all under `cli/src/commands/transcribe/archive/`).

Reused (do not modify): `cli/src/commands/transcribe/process.ts` (`runCommand`),
`cli/src/commands/transcribe/audio.ts` (`getAudioDurationSeconds`),
`cli/src/commands/transcribe/progress.ts` (`createFfmpegProgressHandler`,
`finishProgress`). Because the new files live in `transcribe/archive/`, these are
imported one level up (`../process.js`, `../audio.js`, `../progress.js`).

---

### Task 1: Config accessors

**Files:**

- Modify: `cli/src/config.ts`

**Interfaces:**

- Consumes: the existing module-level `config` object.
- Produces:
  - `getConfigBaseDir(): string` — absolute base for resolving relative
    `transcribeDir` / `outputDir`.
  - `getTranscribeConfig(): Record<string, any>` — the top-level `transcribe:`
    object from `.bfcli.yml`, or `{}` when absent/non-object.

- [ ] **Step 1: Add the accessors**

Open `cli/src/config.ts`. `realCwd`, `localConfigPath`, `config`, and `dirname`
are already in scope. Add these two functions at the end of the file:

```ts
export function getConfigBaseDir(): string {
  return localConfigPath ? dirname(localConfigPath) : realCwd;
}

export function getTranscribeConfig(): Record<string, any> {
  // `config` is typed as `{ contentDir: string }` (spreading a Record does not
  // propagate an index signature under this package's compiler), so cast to
  // read the arbitrary `transcribe` key.
  const value = (config as Record<string, any>)["transcribe"];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
```

- [ ] **Step 2: Typecheck the change**

Run (from `cli/`): `pnpm exec tsc -p src/tsconfig.json`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add cli/src/config.ts
git commit -m "feat(cli): expose config base dir and transcribe config"
```

---

### Task 2: Archive settings resolution (pure)

**Files:**

- Create: `cli/src/commands/transcribe/archive/settings.ts`
- Test: `cli/src/commands/transcribe/archive/settings.test.ts`

**Interfaces:**

- Consumes: nothing (accepts plain objects).
- Produces:
  - `interface RawArchiveConfig { transcribeDir?: string; outputDir?: string; compression?: boolean; audioBitrate?: string; }`
  - `interface ArchiveOverrides { transcribeDir?: string; outputDir?: string; compression?: boolean; bitrate?: string; }`
  - `interface ResolvedArchiveSettings { transcribeDir: string; outputDir: string; compression: boolean; audioBitrate: string; }` (paths are absolute)
  - `const DEFAULT_TRANSCRIBE_DIRNAME = ".bf-transcripts"`
  - `const DEFAULT_OUTPUT_DIRNAME = ".bf-archives"`
  - `const DEFAULT_AUDIO_BITRATE = "32k"`
  - `function resolveArchiveSettings(baseDir: string, config: RawArchiveConfig, overrides?: ArchiveOverrides): ResolvedArchiveSettings`

- [ ] **Step 1: Write the failing test**

Create `cli/src/commands/transcribe/archive/settings.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_AUDIO_BITRATE,
  DEFAULT_OUTPUT_DIRNAME,
  DEFAULT_TRANSCRIBE_DIRNAME,
  resolveArchiveSettings,
} from "./settings.js";

test("applies defaults relative to the base dir when config is empty", () => {
  const settings = resolveArchiveSettings("/repo/astro", {});
  assert.equal(
    settings.transcribeDir,
    `/repo/astro/${DEFAULT_TRANSCRIBE_DIRNAME}`,
  );
  assert.equal(settings.outputDir, `/repo/astro/${DEFAULT_OUTPUT_DIRNAME}`);
  assert.equal(settings.compression, true);
  assert.equal(settings.audioBitrate, DEFAULT_AUDIO_BITRATE);
});

test("resolves relative config paths against the base dir", () => {
  const settings = resolveArchiveSettings("/repo/astro", {
    transcribeDir: "transcripts",
    outputDir: "../archives",
    compression: false,
    audioBitrate: "24k",
  });
  assert.equal(settings.transcribeDir, "/repo/astro/transcripts");
  assert.equal(settings.outputDir, "/repo/archives");
  assert.equal(settings.compression, false);
  assert.equal(settings.audioBitrate, "24k");
});

test("keeps absolute config paths and lets overrides win", () => {
  const settings = resolveArchiveSettings(
    "/repo/astro",
    {
      transcribeDir: "/data/t",
      outputDir: "/data/out",
      compression: true,
      audioBitrate: "48k",
    },
    { compression: false, outputDir: "/tmp/out", bitrate: "16k" },
  );
  assert.equal(settings.transcribeDir, "/data/t");
  assert.equal(settings.outputDir, "/tmp/out");
  assert.equal(settings.compression, false);
  assert.equal(settings.audioBitrate, "16k");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `cli/`): `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/settings.test.ts`
Expected: FAIL — cannot resolve module `./settings.js`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/commands/transcribe/archive/settings.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `cli/`): `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/settings.test.ts`
Expected: PASS — `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/transcribe/archive/settings.ts cli/src/commands/transcribe/archive/settings.test.ts
git commit -m "feat(cli): resolve transcript archive settings"
```

---

### Task 3: Archive plan mapping (pure)

**Files:**

- Create: `cli/src/commands/transcribe/archive/plan.ts`
- Test: `cli/src/commands/transcribe/archive/plan.test.ts`

**Interfaces:**

- Consumes: nothing (accepts plain strings).
- Produces:
  - `interface ArchiveSourceFile { sourcePath: string; entryName: string; required: boolean; }`
  - `interface ArchivePlan { sessionName: string; audioSource: string; audioEntryName: string; copies: ArchiveSourceFile[]; zipPath: string; unpackedDir: string; }`
  - `interface BuildArchivePlanOptions { sessionDir: string; transcribeDir: string; outputDir: string; audioExtension: string; }`
  - `function buildArchivePlan(options: BuildArchivePlanOptions): ArchivePlan`

- [ ] **Step 1: Write the failing test**

Create `cli/src/commands/transcribe/archive/plan.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildArchivePlan } from "./plan.js";

test("maps a session dir to audio source, entry names, and outputs", () => {
  const plan = buildArchivePlan({
    sessionDir: "/repo/astro/.bf-transcripts/session-2026-05-22",
    transcribeDir: "/repo/astro/.bf-transcripts",
    outputDir: "/repo/astro/.bf-archives",
    audioExtension: "opus",
  });

  assert.equal(plan.sessionName, "session-2026-05-22");
  assert.equal(
    plan.audioSource,
    "/repo/astro/.bf-transcripts/session-2026-05-22/normalized/session.flac",
  );
  assert.equal(plan.audioEntryName, "session-audio.opus");
  assert.equal(plan.zipPath, "/repo/astro/.bf-archives/session-2026-05-22.zip");
  assert.equal(plan.unpackedDir, "/repo/astro/.bf-archives/session-2026-05-22");
});

test("includes transcripts and shared corrections with required flags", () => {
  const plan = buildArchivePlan({
    sessionDir: "/t/session1",
    transcribeDir: "/t",
    outputDir: "/out",
    audioExtension: "opus",
  });

  assert.deepEqual(plan.copies, [
    {
      sourcePath: "/t/session1/raw_transcript.md",
      entryName: "raw_transcript.md",
      required: true,
    },
    {
      sourcePath: "/t/session1/corrected_transcript.md",
      entryName: "corrected_transcript.md",
      required: false,
    },
    {
      sourcePath: "/t/corrections.yaml",
      entryName: "corrections.yaml",
      required: false,
    },
  ]);
});

test("honors a non-opus audio extension", () => {
  const plan = buildArchivePlan({
    sessionDir: "/t/s",
    transcribeDir: "/t",
    outputDir: "/out",
    audioExtension: "ogg",
  });
  assert.equal(plan.audioEntryName, "session-audio.ogg");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `cli/`): `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/plan.test.ts`
Expected: FAIL — cannot resolve module `./plan.js`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/commands/transcribe/archive/plan.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `cli/`): `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/plan.test.ts`
Expected: PASS — `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/transcribe/archive/plan.ts cli/src/commands/transcribe/archive/plan.test.ts
git commit -m "feat(cli): build transcript archive file plan"
```

---

### Task 4: Opus encoding

**Files:**

- Create: `cli/src/commands/transcribe/archive/encode.ts`
- Test: `cli/src/commands/transcribe/archive/encode.test.ts`

**Interfaces:**

- Consumes: `runCommand` from `../process.js`; `getAudioDurationSeconds` from
  `../audio.js`; `createFfmpegProgressHandler`, `finishProgress`, and
  `type ProgressSink` from `../progress.js`.
- Produces:
  - `interface BuildOpusArgsOptions { input: string; output: string; bitrate: string; force: boolean; }`
  - `function buildOpusArgs(options: BuildOpusArgsOptions): string[]`
  - `interface EncodeToOpusOptions { input: string; output: string; bitrate: string; force: boolean; progress?: ProgressSink; }`
  - `function encodeToOpus(options: EncodeToOpusOptions): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `cli/src/commands/transcribe/archive/encode.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOpusArgs } from "./encode.js";

test("builds ffmpeg args for a compact speech-tuned opus encode", () => {
  const args = buildOpusArgs({
    input: "/t/session.flac",
    output: "/tmp/out.opus",
    bitrate: "32k",
    force: true,
  });

  assert.deepEqual(args, [
    "-hide_banner",
    "-nostats",
    "-progress",
    "pipe:1",
    "-y",
    "-i",
    "/t/session.flac",
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    "32k",
    "-application",
    "voip",
    "/tmp/out.opus",
  ]);
});

test("uses -n instead of -y when not forcing overwrite", () => {
  const args = buildOpusArgs({
    input: "/t/in.flac",
    output: "/t/out.opus",
    bitrate: "24k",
    force: false,
  });
  assert.ok(args.includes("-n"));
  assert.ok(!args.includes("-y"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `cli/`): `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/encode.test.ts`
Expected: FAIL — cannot resolve module `./encode.js`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/commands/transcribe/archive/encode.ts`:

```ts
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { getAudioDurationSeconds } from "../audio.js";
import { runCommand } from "../process.js";
import {
  createFfmpegProgressHandler,
  finishProgress,
  type ProgressSink,
} from "../progress.js";

export interface BuildOpusArgsOptions {
  input: string;
  output: string;
  bitrate: string;
  force: boolean;
}

export function buildOpusArgs(options: BuildOpusArgsOptions): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-progress",
    "pipe:1",
    options.force ? "-y" : "-n",
    "-i",
    options.input,
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    options.bitrate,
    "-application",
    "voip",
    options.output,
  ];
}

export interface EncodeToOpusOptions {
  input: string;
  output: string;
  bitrate: string;
  force: boolean;
  progress?: ProgressSink;
}

export async function encodeToOpus(
  options: EncodeToOpusOptions,
): Promise<void> {
  await mkdir(dirname(options.output), { recursive: true });
  const reporter = options.progress
    ? {
        label: "Encode Opus",
        totalSeconds: await getAudioDurationSeconds(options.input),
        sink: options.progress,
      }
    : undefined;
  await runCommand("ffmpeg", buildOpusArgs(options), {
    onStdout: createFfmpegProgressHandler(reporter),
  });
  finishProgress(reporter);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `cli/`): `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/encode.test.ts`
Expected: PASS — `# pass 2`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/transcribe/archive/encode.ts cli/src/commands/transcribe/archive/encode.test.ts
git commit -m "feat(cli): encode session audio to compact opus"
```

---

### Task 5: Zip archive writer

**Files:**

- Modify: `cli/package.json`
- Create: `cli/src/commands/transcribe/archive/zip.ts`
- Test: `cli/src/commands/transcribe/archive/zip.test.ts`

**Interfaces:**

- Consumes: `adm-zip` (new dependency).
- Produces:
  - `interface ZipEntry { path: string; name: string; }`
  - `function createZipArchive(entries: ZipEntry[], outPath: string): Promise<void>`

- [ ] **Step 1: Add the dependency**

Run (from `cli/`): `pnpm add adm-zip && pnpm add -D @types/adm-zip`
Expected: `package.json` gains `adm-zip` under `dependencies` and `@types/adm-zip`
under `devDependencies`; lockfile updates. (Because esbuild marks all
`dependencies` as external in `scripts/build.mjs`, no bundler change is needed.)

- [ ] **Step 2: Write the failing test**

Create `cli/src/commands/transcribe/archive/zip.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import AdmZip from "adm-zip";

import { createZipArchive } from "./zip.js";

test("writes a zip whose entries use the provided names and contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-archive-zip-"));
  const audioPath = join(dir, "tmp-audio.opus");
  const transcriptPath = join(dir, "raw_transcript.md");
  await writeFile(audioPath, "FAKE_OPUS_BYTES", "utf8");
  await writeFile(transcriptPath, "# transcript\n", "utf8");

  const outPath = join(dir, "nested", "session1.zip");
  await createZipArchive(
    [
      { path: audioPath, name: "session-audio.opus" },
      { path: transcriptPath, name: "raw_transcript.md" },
    ],
    outPath,
  );

  // File exists on disk.
  await readFile(outPath);

  const zip = new AdmZip(outPath);
  const names = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .sort();
  assert.deepEqual(names, ["raw_transcript.md", "session-audio.opus"]);
  assert.equal(zip.readAsText("raw_transcript.md"), "# transcript\n");
  assert.equal(zip.readAsText("session-audio.opus"), "FAKE_OPUS_BYTES");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `cli/`): `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/zip.test.ts`
Expected: FAIL — cannot resolve module `./zip.js`.

- [ ] **Step 4: Write minimal implementation**

Create `cli/src/commands/transcribe/archive/zip.ts`:

```ts
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import AdmZip from "adm-zip";

export interface ZipEntry {
  path: string;
  name: string;
}

export async function createZipArchive(
  entries: ZipEntry[],
  outPath: string,
): Promise<void> {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addLocalFile(entry.path, "", entry.name);
  }
  await mkdir(dirname(outPath), { recursive: true });
  zip.writeZip(outPath);
}
```

Note: `adm-zip` buffers file contents in memory. Session audio is already
re-encoded to a compact Opus file (typically tens of MB), so peak memory stays
well within acceptable bounds for an occasional archival command.

- [ ] **Step 5: Run test to verify it passes**

Run (from `cli/`): `pnpm exec tsx --tsconfig src/tsconfig.json --test src/commands/transcribe/archive/zip.test.ts`
Expected: PASS — `# pass 1`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add cli/package.json ../pnpm-lock.yaml cli/src/commands/transcribe/archive/zip.ts cli/src/commands/transcribe/archive/zip.test.ts
git commit -m "feat(cli): write transcript archives as zip"
```

(If the lockfile lives elsewhere or is unchanged, drop `../pnpm-lock.yaml` from
the `git add`.)

---

### Task 6: Subcommand implementation + registration

**Files:**

- Create: `cli/src/commands/transcribe/archive/impl.ts`
- Create: `cli/src/commands/transcribe/archive/command.ts`
- Modify: `cli/src/commands/transcribe/command.ts`

**Interfaces:**

- Consumes: `resolveArchiveSettings`, `RawArchiveConfig` (`./settings.js`);
  `buildArchivePlan`, `type ArchiveSourceFile` (`./plan.js`); `encodeToOpus`
  (`./encode.js`); `createZipArchive`, `type ZipEntry` (`./zip.js`); `config`,
  `getConfigBaseDir`, `getTranscribeConfig` (`@/config.js`); `type LocalContext`
  (`@/context.js`).
- Produces:
  - `impl.ts`: `interface ArchiveFlags { compression?: boolean; "output-dir"?: string; "transcribe-dir"?: string; bitrate?: string; force?: boolean; }` and a default-exported `async function archive(this: LocalContext, flags: ArchiveFlags, session: string): Promise<void>`.
  - `command.ts`: `export const archiveCommand` (a Stricli command).

- [ ] **Step 1: Write the implementation handler**

Create `cli/src/commands/transcribe/archive/impl.ts`:

```ts
import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getConfigBaseDir, getTranscribeConfig } from "@/config.js";
import type { LocalContext } from "@/context.js";
import { encodeToOpus } from "./encode.js";
import { buildArchivePlan, type ArchiveSourceFile } from "./plan.js";
import { resolveArchiveSettings, type RawArchiveConfig } from "./settings.js";
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
  const candidates = [join(cwd, session), join(transcribeDir, session)];
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
      this.process.stdout.write(
        `Skipping missing ${copy.entryName} (${copy.sourcePath})\n`,
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
    await rm(destination, { recursive: true, force: true });
  }

  const tempAudio = join(
    tmpdir(),
    `${plan.sessionName}-${plan.audioEntryName}`,
  );
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

  try {
    if (settings.compression) {
      const entries: ZipEntry[] = [
        { path: tempAudio, name: plan.audioEntryName },
        ...includedCopies.map((copy) => ({
          path: copy.sourcePath,
          name: copy.entryName,
        })),
      ];
      await createZipArchive(entries, plan.zipPath);
      this.process.stdout.write(`Wrote archive ${plan.zipPath}\n`);
    } else {
      await mkdir(plan.unpackedDir, { recursive: true });
      await copyFile(tempAudio, join(plan.unpackedDir, plan.audioEntryName));
      for (const copy of includedCopies) {
        await copyFile(copy.sourcePath, join(plan.unpackedDir, copy.entryName));
      }
      this.process.stdout.write(
        `Wrote archive contents to ${plan.unpackedDir}\n`,
      );
    }
  } finally {
    await rm(tempAudio, { force: true });
  }
}
```

Note: `this.process.stdout` satisfies the `ProgressSink { write(message: string): void }`
interface used by `encodeToOpus`.

- [ ] **Step 2: Write the command definition**

Create `cli/src/commands/transcribe/archive/command.ts`:

```ts
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
        },
      ],
    },
  },
  docs: {
    brief:
      "Package a transcript session's audio and transcripts into a compact archive",
  },
});
```

- [ ] **Step 3: Register the subcommand in the transcribe route map**

Edit `cli/src/commands/transcribe/command.ts`.

First add the import near the other imports at the top of the file (the file
already imports from `./applyCorrections.js` and similar siblings — place this
alongside them):

```ts
import { archiveCommand } from "./archive/command.js";
```

Then add the route to the existing `transcribeCommand` route map (near the end of
the file). Change:

```ts
export const transcribeCommand = buildRouteMap({
  routes: {
    run: transcribeRunCommand,
    audio: transcribeRunCommand,
    "apply-corrections": applyCorrectionsCommand,
  },
  defaultCommand: "run",
```

to:

```ts
export const transcribeCommand = buildRouteMap({
  routes: {
    run: transcribeRunCommand,
    audio: transcribeRunCommand,
    "apply-corrections": applyCorrectionsCommand,
    archive: archiveCommand,
  },
  defaultCommand: "run",
```

- [ ] **Step 4: Typecheck and build**

Run (from `cli/`): `pnpm exec tsc -p src/tsconfig.json && pnpm build`
Expected: `tsc` exits 0 with no output; `pnpm build` finishes with esbuild
success and copies templates. No errors.

- [ ] **Step 5: Verify the subcommand is wired up**

Run (from `cli/`): `pnpm exec bfcli transcribe archive --help`
Expected: help text showing the `archive` positional session argument and the
`--compression`, `--output-dir`, `--transcribe-dir`, `--bitrate`, and `--force`
flags. (If `bfcli` is not on PATH, use `node dist/cli.js transcribe archive --help`.)

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/transcribe/archive/impl.ts cli/src/commands/transcribe/archive/command.ts cli/src/commands/transcribe/command.ts
git commit -m "feat(cli): add transcribe archive subcommand"
```

---

### Task 7: End-to-end verification against a real session

**Files:** none (verification only).

**Interfaces:**

- Consumes: the built `transcribe archive` subcommand; a real session under
  `astro/.bf-transcripts/`.

- [ ] **Step 1: Add archive config under the transcribe object**

Edit `astro/.bfcli.yml` to add (the file already has a top-level `tts:` object;
add a sibling `transcribe:` object):

```yaml
transcribe:
  transcribeDir: .bf-transcripts
  outputDir: .bf-archives
  compression: true
  audioBitrate: 32k
```

- [ ] **Step 2: Run the full CLI test suite**

Run (from `cli/`): `pnpm test`
Expected: all tests pass, including the four new
`transcribe/archive/*.test.ts` files; no failures.

- [ ] **Step 3: Produce a compressed archive from a real session**

Run (from `astro/`, where `.bfcli.yml` lives):
`pnpm exec bfcli transcribe archive session-2026-05-22`
(or `node ../cli/dist/cli.js transcribe archive session-2026-05-22` if `bfcli` is
not on PATH)
Expected: progress output for the Opus encode, then
`Wrote archive .../astro/.bf-archives/session-2026-05-22.zip`.

- [ ] **Step 4: Inspect the produced zip**

Run (from `astro/`): `unzip -l .bf-archives/session-2026-05-22.zip`
Expected: the listing contains `session-audio.opus`, `raw_transcript.md`,
`corrected_transcript.md`, and `corrections.yaml`, and the total size is far
smaller than the original `normalized/session.flac` (hundreds of MB → tens of MB).

- [ ] **Step 5: Produce an uncompressed archive**

Run (from `astro/`):
`pnpm exec bfcli transcribe archive session-2026-05-22 --compression false --force`
Expected: `Wrote archive contents to .../astro/.bf-archives/session-2026-05-22`,
and `ls .bf-archives/session-2026-05-22` shows the same four files as loose files.

- [ ] **Step 6: Clean up verification artifacts (optional)**

Run (from `astro/`): `rm -rf .bf-archives/session-2026-05-22 .bf-archives/session-2026-05-22.zip`
Expected: no output; verification artifacts removed. (Skip if the archives should
be kept.)

---

## Self-Review

**1. Spec coverage:**

- "Move the command into the `transcribe` namespace (`bfcli transcribe archive`)"
  → Task 6 Step 3 registers `archive` in the `transcribeCommand` route map; all
  files live under `cli/src/commands/transcribe/archive/`.
- "Config all under a top-level `transcribe:` object" → Task 1
  (`getTranscribeConfig()`) + Task 2 (`resolveArchiveSettings`) + Task 7 Step 1
  (`.bfcli.yml` `transcribe:` block).
- "Takes a `.bf-transcripts` subdirectory" → Task 6 positional session +
  `resolveSessionDir` (accepts a name under `transcribeDir` or a path).
- "Re-encode the full `.flac` into a compact lossy codec" → Task 4 (Opus via
  `libopus`, `-application voip`, configurable bitrate) encoding
  `normalized/session.flac`.
- "Along with the transcriptions" → Task 3 plan + Task 6 impl include
  `raw_transcript.md`, `corrected_transcript.md`, and `corrections.yaml`.
- `transcribeDir`, `compression`, `outputDir` configurable → Task 2 defaults
  (`.bf-transcripts`, `.bf-archives`, compression `true`) resolved against
  `getConfigBaseDir()`, overridable by flags.
- "compression true → `.zip`; false → subdirectory in `outputDir`" → Task 5 +
  Task 6 branch on `settings.compression`.
- Output file names `session-audio.<ext>`, `raw_transcript.md`,
  `corrected_transcript.md`, `corrections.yaml` → Task 3 entry names + Task 6.
- Future note: "`transcribeDir` also read by `bfcli transcribe run`" stays out of
  scope; `getTranscribeConfig()` + `resolveArchiveSettings` make it a small
  follow-up.

**2. Placeholder scan:** No TBD/TODO or "handle edge cases" placeholders; every
code step contains full implementations and every command step lists expected
output.

**3. Type consistency:** `resolveArchiveSettings` (Task 2) returns
`ResolvedArchiveSettings` consumed in Task 6; `getTranscribeConfig()` returns
`Record<string, any>`, assignable to the `RawArchiveConfig` parameter of
`resolveArchiveSettings`; `buildArchivePlan` (Task 3) returns
`ArchivePlan`/`ArchiveSourceFile` consumed in Task 6; `encodeToOpus` /
`buildOpusArgs` options (Task 4) match calls in Task 6; `createZipArchive` /
`ZipEntry` (Task 5) match Task 6 usage; `ArchiveFlags` keys (`"output-dir"`,
`"transcribe-dir"`, `compression`, `bitrate`, `force`) match the flag names
declared in `command.ts`. `ProgressSink.write(message: string)` is satisfied by
`this.process.stdout`. The `encode.ts` imports (`../process.js`, `../audio.js`,
`../progress.js`) resolve correctly from `transcribe/archive/`.
