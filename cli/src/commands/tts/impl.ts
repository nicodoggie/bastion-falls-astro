import type { LocalContext } from "@/context.js";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { glob } from "tinyglobby";

import {
  buildEarlyHickMbrolaPlan,
  loadLexiconEntries,
  mbrolaSourcePaths,
  slugForLexiconEntry,
  splitEntryForPostVcGlottal,
  uniqueSlugsForLexiconEntries,
  type EarlyHickMbrolaPlan,
  type LexiconPronunciationEntry,
} from "./earlyHick.js";

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

interface ManifestItem {
  id: string;
  slug: string;
  writtenForm: string;
  phoneticForm: string;
  approximations: EarlyHickMbrolaPlan["approximations"];
  unsupported: string[];
  status: "generated" | "skipped";
  skipReason?: string;
  phoPath?: string;
  mbrolaSourcePath?: string;
  outputPath?: string;
  sources?: WebAudioSource[];
  workingOutputPath?: string;
  postVcGlottal?: {
    gapMs: number;
    chunks: Array<{
      writtenForm: string;
      phoneticForm: string;
      mbrolaSourcePath: string;
      outputPath: string;
    }>;
  };
  sourceProbe?: unknown;
  outputProbe?: unknown;
}

interface PublicManifestItem {
  id: string;
  slug: string;
  writtenForm: string;
  phoneticForm: string;
  approximations: EarlyHickMbrolaPlan["approximations"];
  unsupported: string[];
  status: "generated" | "skipped";
  skipReason?: string;
  outputPath?: string;
  sources?: WebAudioSource[];
  postVcGlottal?: {
    gapMs: number;
    chunks: Array<{
      writtenForm: string;
      phoneticForm: string;
    }>;
  };
}

interface SplicePlan {
  outputPath: string;
  gapMs: number;
  chunkOutputs: string[];
}

interface WebAudioSource {
  outputPath: string;
  type: string;
}

interface WebAudioOutputPlan {
  primaryOutputPath: string;
  sources: WebAudioSource[];
  publicCopies: string[];
}

export const DEFAULT_EARLY_HICK_AUDIO_OUT_DIR =
  "astro/src/assets/languages/hickic/seneran/early-hick/audio/lexicon";
export const DEFAULT_EARLY_HICK_AUDIO_PUBLIC_OUT_DIR =
  "astro/public/languages/hickic/seneran/early-hick/audio/lexicon";
export const DEFAULT_EARLY_HICK_AUDIO_WORK_DIR = "/tmp/early-hick-tts-cli";

const CHATTERBOX_SCRIPT = String.raw`
import json
from pathlib import Path

import torch
import torchaudio as ta
from chatterbox.vc import ChatterboxVC

batch_path = Path(__import__("sys").argv[1])
batch = json.loads(batch_path.read_text())
requested_device = batch.get("device", "auto")
if requested_device == "auto":
    device = "cuda" if torch.cuda.is_available() else "cpu"
else:
    device = requested_device

model = ChatterboxVC.from_pretrained(device=device)
for item in batch["items"]:
    wav = model.generate(item["source"], target_voice_path=batch["target_voice_path"])
    ta.save(item["output"], wav, model.sr)

(batch_path.parent / "chatterbox-device.txt").write_text(device + "\n")
`;

export default async function ttsLexicon(
  this: LocalContext,
  flags: TtsLexiconFlags,
): Promise<void> {
  const cwd = this.currentPath;
  const outDir = resolveMaybe(cwd, flags.out);
  const publicOutDir = resolveMaybe(cwd, flags["public-out"]);
  const workDir = resolveMaybe(cwd, flags["work-dir"]);
  const shardPaths = await glob(flags["lexicon-glob"], {
    cwd,
    absolute: true,
    onlyFiles: true,
  });
  if (!shardPaths.length) {
    throw new Error(`No lexicon shards matched ${flags["lexicon-glob"]}`);
  }

  await mkdir(outDir, { recursive: true });
  await mkdir(publicOutDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const entries = selectEntries(await loadLexiconEntries(shardPaths), flags);
  const uniqueSlugs = uniqueSlugsForLexiconEntries(entries);
  this.process.stdout.write(`Selected ${entries.length} lexical entries\n`);

  const manifestItems: ManifestItem[] = [];
  const webOutputsById = new Map<string, WebAudioOutputPlan>();
  const vcItems: Array<{ source: string; output: string }> = [];
  const splicePlans: SplicePlan[] = [];
  const vcDir = join(workDir, "vc", flags.voice);
  await mkdir(join(workDir, "mbrola", "pho"), { recursive: true });
  await mkdir(join(workDir, "mbrola", "wav"), { recursive: true });
  await mkdir(vcDir, { recursive: true });

  for (const entry of entries) {
    const plan = buildEarlyHickMbrolaPlan(entry);
    const slug = uniqueSlugs.get(entry.id) ?? plan.slug;
    const paths = mbrolaSourcePaths(workDir, slug);
    const workingOutputPath = join(vcDir, `${slug}.wav`);
    const webOutputs = webAudioOutputsForSlug(outDir, publicOutDir, slug, flags.voice);
    webOutputsById.set(plan.id, webOutputs);
    const item: ManifestItem = {
      id: plan.id,
      slug,
      writtenForm: plan.writtenForm,
      phoneticForm: plan.phoneticForm,
      approximations: plan.approximations,
      unsupported: plan.unsupported,
      status: "generated",
      phoPath: paths.pho,
      mbrolaSourcePath: paths.wav,
      outputPath: webOutputs.primaryOutputPath,
      sources: webOutputs.sources,
      workingOutputPath: flags["skip-vc"] ? paths.wav : workingOutputPath,
    };

    if (plan.unsupported.length) {
      item.status = "skipped";
      item.skipReason = `Unsupported phonetic symbols: ${plan.unsupported.join(", ")}`;
      manifestItems.push(item);
      continue;
    }

    await mkdir(dirname(paths.pho), { recursive: true });
    await writeFile(paths.pho, plan.pho, "utf8");

    if (flags.force || !(await fileExists(paths.wav))) {
      await runCommand("mbrola", ["-e", flags["mbrola-db"], paths.pho, paths.wav], { cwd });
    }
    item.sourceProbe = await probeAudio(paths.wav).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));

    if (!flags["skip-vc"]) {
      const split = splitEntryForPostVcGlottal(entry);
      if (split) {
        const splitChunks = [];
        const chunkOutputs: string[] = [];
        for (const [index, chunk] of split.chunks.entries()) {
          const chunkPlan = buildEarlyHickMbrolaPlan(chunk);
          const chunkStem = `${index + 1}-${chunkPlan.slug}`;
          const chunkPho = join(workDir, "mbrola", "pho-chunks", slug, `${chunkStem}.pho`);
          const chunkWav = join(workDir, "mbrola", "wav-chunks", slug, `${chunkStem}.wav`);
          const chunkOutput = join(workDir, "vc-chunks", flags.voice, slug, `${chunkStem}.wav`);
          if (chunkPlan.unsupported.length) {
            item.status = "skipped";
            item.skipReason = `Unsupported glottal chunk phonetic symbols: ${chunkPlan.unsupported.join(", ")}`;
            break;
          }

          await mkdir(dirname(chunkPho), { recursive: true });
          await mkdir(dirname(chunkWav), { recursive: true });
          await mkdir(dirname(chunkOutput), { recursive: true });
          await writeFile(chunkPho, chunkPlan.pho, "utf8");
          if (flags.force || !(await fileExists(chunkWav))) {
            await runCommand("mbrola", ["-e", flags["mbrola-db"], chunkPho, chunkWav], { cwd });
          }
          vcItems.push({ source: chunkWav, output: chunkOutput });
          chunkOutputs.push(chunkOutput);
          splitChunks.push({
            writtenForm: chunk.writtenForm,
            phoneticForm: chunk.phoneticForm,
            mbrolaSourcePath: chunkWav,
            outputPath: chunkOutput,
          });
        }

        if (item.status === "generated") {
          item.postVcGlottal = {
            gapMs: split.gapMs,
            chunks: splitChunks,
          };
          splicePlans.push({
            outputPath: workingOutputPath,
            gapMs: split.gapMs,
            chunkOutputs,
          });
        }
      } else {
        vcItems.push({ source: paths.wav, output: workingOutputPath });
      }
    }
    manifestItems.push(item);
  }

  let targetVoicePath: string | undefined;
  let chatterboxDevice: string | undefined;
  if (!flags["skip-vc"] && vcItems.length) {
    targetVoicePath = await prepareReferenceAudio(workDir, flags, cwd);
    const batchDir = join(workDir, "chatterbox");
    await mkdir(batchDir, { recursive: true });
    const batchPath = join(batchDir, "batch.json");
    const scriptPath = join(batchDir, "chatterbox-vc-batch.py");
    await writeFile(scriptPath, CHATTERBOX_SCRIPT, "utf8");
    await writeFile(
      batchPath,
      JSON.stringify(
        {
          device: flags.device,
          target_voice_path: targetVoicePath,
          items: vcItems,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await runCommand(flags["chatterbox-python"], [scriptPath, batchPath], { cwd });
    chatterboxDevice = await readFile(join(batchDir, "chatterbox-device.txt"), "utf8")
      .then((value) => value.trim())
      .catch(() => undefined);

    for (const splicePlan of splicePlans) {
      await splicePostVcGlottal(splicePlan, cwd);
    }
  }

  for (const item of manifestItems) {
    if (item.status !== "generated" || !item.workingOutputPath || !item.outputPath || !item.sources) {
      continue;
    }
    await encodeWebAudio(item.workingOutputPath, item.sources, flags.force === true, cwd);
    const webOutputs = webOutputsById.get(item.id);
    if (webOutputs) {
      await mirrorWebAudio(webOutputs, flags.force === true);
    }
    item.outputProbe = await probeAudio(item.outputPath).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const manifestPath = join(outDir, "tts-lexicon-manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        lexiconGlob: flags["lexicon-glob"],
        mbrola: {
          profile: "early-hick-mbrola",
        },
        voiceConversion: flags["skip-vc"]
          ? undefined
          : {
              enabled: true,
              requestedDevice: flags.device,
              device: chatterboxDevice,
            },
        items: manifestItems.map(toPublicManifestItem),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const generated = manifestItems.filter((item) => item.status === "generated").length;
  const skipped = manifestItems.length - generated;
  this.process.stdout.write(`Generated ${generated}; skipped ${skipped}\n`);
  this.process.stdout.write(`Manifest: ${manifestPath}\n`);
}

export function toPublicManifestItem(item: ManifestItem): PublicManifestItem {
  return {
    id: item.id,
    slug: item.slug,
    writtenForm: item.writtenForm,
    phoneticForm: item.phoneticForm,
    approximations: item.approximations,
    unsupported: item.unsupported,
    status: item.status,
    ...(item.skipReason ? { skipReason: item.skipReason } : {}),
    ...(item.outputPath ? { outputPath: basename(item.outputPath) } : {}),
    ...(item.sources?.length
      ? {
          sources: item.sources.map((source) => ({
            outputPath: basename(source.outputPath),
            type: source.type,
          })),
        }
      : {}),
    ...(item.postVcGlottal
      ? {
          postVcGlottal: {
            gapMs: item.postVcGlottal.gapMs,
            chunks: item.postVcGlottal.chunks.map((chunk) => ({
              writtenForm: chunk.writtenForm,
              phoneticForm: chunk.phoneticForm,
            })),
          },
        }
      : {}),
  };
}

export function webAudioOutputsForSlug(
  outDir: string,
  publicOutDir: string,
  slug: string,
  _voice: string,
): WebAudioOutputPlan {
  const stem = slug;
  return {
    primaryOutputPath: join(outDir, `${stem}.webm`),
    sources: [
      {
        outputPath: join(outDir, `${stem}.webm`),
        type: "audio/webm; codecs=opus",
      },
      {
        outputPath: join(outDir, `${stem}.mp3`),
        type: "audio/mpeg",
      },
    ],
    publicCopies: [
      join(publicOutDir, `${stem}.webm`),
      join(publicOutDir, `${stem}.mp3`),
    ],
  };
}

function selectEntries(
  entries: readonly LexiconPronunciationEntry[],
  flags: Pick<TtsLexiconFlags, "ids" | "limit">,
): LexiconPronunciationEntry[] {
  const selectedIds = new Set(
    flags.ids?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
  );
  const filtered = selectedIds.size
    ? entries.filter((entry) =>
        selectedIds.has(entry.id) ||
        selectedIds.has(entry.writtenForm) ||
        selectedIds.has(slugForLexiconEntry(entry)),
      )
    : [...entries];
  return typeof flags.limit === "number" && flags.limit > 0
    ? filtered.slice(0, Math.floor(flags.limit))
    : filtered;
}

async function prepareReferenceAudio(
  outDir: string,
  flags: Pick<TtsLexiconFlags, "reference-audio" | "voice" | "force">,
  cwd: string,
): Promise<string> {
  const targetPath = join(outDir, "reference", "reference.wav");
  await mkdir(dirname(targetPath), { recursive: true });
  if (flags.force || !(await fileExists(targetPath))) {
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-y",
      "-i",
      resolveMaybe(cwd, flags["reference-audio"]),
      "-ac",
      "1",
      "-ar",
      "16000",
      targetPath,
    ], { cwd });
  }
  return targetPath;
}

async function probeAudio(audioPath: string): Promise<unknown> {
  const raw = await runCommandCapture("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=sample_rate,channels",
    "-show_entries",
    "format=duration,size",
    "-of",
    "json",
    audioPath,
  ]);
  return JSON.parse(raw) as unknown;
}

async function encodeWebAudio(
  sourceWavPath: string,
  sources: readonly WebAudioSource[],
  force: boolean,
  cwd: string,
): Promise<void> {
  for (const source of sources) {
    await mkdir(dirname(source.outputPath), { recursive: true });
    if (!force && await fileExists(source.outputPath)) continue;
    const ext = source.outputPath.toLowerCase().split(".").at(-1);
    if (ext === "webm") {
      await runCommand("ffmpeg", [
        "-hide_banner",
        "-y",
        "-i",
        sourceWavPath,
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        source.outputPath,
      ], { cwd });
      continue;
    }
    if (ext === "mp3") {
      await runCommand("ffmpeg", [
        "-hide_banner",
        "-y",
        "-i",
        sourceWavPath,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        source.outputPath,
      ], { cwd });
      continue;
    }
    throw new Error(`Unsupported web audio output format: ${source.outputPath}`);
  }
}

async function mirrorWebAudio(plan: WebAudioOutputPlan, force: boolean): Promise<void> {
  for (const [index, source] of plan.sources.entries()) {
    const publicCopy = plan.publicCopies[index];
    if (!publicCopy) continue;
    await mkdir(dirname(publicCopy), { recursive: true });
    if (!force && await fileExists(publicCopy)) continue;
    await copyFile(source.outputPath, publicCopy);
  }
}

async function splicePostVcGlottal(plan: SplicePlan, cwd: string): Promise<void> {
  if (plan.chunkOutputs.length < 2) return;
  await mkdir(dirname(plan.outputPath), { recursive: true });

  const args = ["-hide_banner", "-y"];
  for (const [index, chunkOutput] of plan.chunkOutputs.entries()) {
    args.push("-i", chunkOutput);
    if (index < plan.chunkOutputs.length - 1) {
      args.push(
        "-f",
        "lavfi",
        "-t",
        (plan.gapMs / 1000).toFixed(3),
        "-i",
        "anullsrc=r=24000:cl=mono",
      );
    }
  }

  const inputCount = plan.chunkOutputs.length * 2 - 1;
  args.push(
    "-filter_complex",
    Array.from({ length: inputCount }, (_, index) => `[${index}:a]`).join("") +
      `concat=n=${inputCount}:v=0:a=1[out]`,
    "-map",
    "[out]",
    plan.outputPath,
  );

  await runCommand("ffmpeg", args, { cwd });
}

function resolveMaybe(cwd: string, value: string): string {
  return isAbsolute(value) ? value : resolve(cwd, value);
}

async function fileExists(path: string): Promise<boolean> {
  return await stat(path).then((info) => info.isFile()).catch(() => false);
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string },
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with status ${String(code)}`));
    });
  });
}

async function runCommandCapture(command: string, args: readonly string[]): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} exited with status ${String(code)}: ${stderr}`));
    });
  });
}
