import { buildCommand, type FlagParametersForType } from "@stricli/core";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { LocalContext } from "@/context.js";
import { correctedTranscriptionDirFor, joinCorrectedTranscriptChunks, naturalTranscriptChunkSort } from "./codex.js";
import { generateWithOllama } from "./ollamaNotes.js";
import { runCommand } from "./process.js";

type CorrectionAction = "accept" | "reject" | "edit" | "skip" | "context";
type CorrectionBackend = "codex" | "ollama";

export interface CorrectionDecisionInput {
  action: CorrectionAction;
  original: string;
  correction?: string;
  applyGlobally?: boolean;
  note?: string;
}

export interface CorrectionDecision extends CorrectionDecisionInput {
  alias?: {
    from: string;
    to: string;
  };
}

interface ApplyCorrectionFlags {
  answers?: string;
  annotated?: string;
  apply?: boolean;
  editor?: string;
  "correction-backend": CorrectionBackend;
  "correction-model": string;
  force?: boolean;
  "ollama-url": string;
}

export function parseCorrectionBackend(value: string): CorrectionBackend {
  if (value === "codex" || value === "ollama") {
    return value;
  }
  throw new Error(`Unsupported correction backend: ${value}`);
}

const flags: FlagParametersForType<ApplyCorrectionFlags, LocalContext> = {
  answers: {
    kind: "parsed",
    parse: String,
    brief: "Path to a correction answer JSON file to apply non-interactively",
    optional: true,
  },
  annotated: {
    kind: "parsed",
    parse: String,
    brief: "Path to annotated correction notes markdown",
    optional: true,
  },
  apply: {
    kind: "boolean",
    brief: "Apply the annotated correction notes and write corrected_transcript.reviewed.md",
    optional: true,
  },
  editor: {
    kind: "parsed",
    parse: String,
    brief: "Editor command used to open the annotated correction notes",
    optional: true,
  },
  "correction-backend": {
    kind: "parsed",
    parse: parseCorrectionBackend,
    brief: "Backend used for --apply: codex or ollama",
    default: "codex",
  },
  "correction-model": {
    kind: "parsed",
    parse: String,
    brief: "Model used by the selected correction backend",
    default: "qwen3:8b",
  },
  force: {
    kind: "boolean",
    brief: "Regenerate reviewed transcript chunks even if they already exist",
    optional: true,
  },
  "ollama-url": {
    kind: "parsed",
    parse: String,
    brief: "Ollama server URL for --correction-backend ollama",
    default: "http://127.0.0.1:11434",
  },
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function normalizeCorrectionDecision(input: CorrectionDecisionInput): CorrectionDecision {
  const decision: CorrectionDecision = { ...input };
  if (decision.action === "edit" && decision.original.trim() && decision.correction?.trim() && decision.applyGlobally) {
    decision.alias = {
      from: decision.original.trim(),
      to: decision.correction.trim(),
    };
  }
  return decision;
}

export function buildApplyCorrectionsPrompt(options: {
  glossary: string;
  rawTranscript: string;
  correctedTranscript: string;
  correctionNotes: string;
  decisions: CorrectionDecision[];
}): string {
  return [
    "Apply these human-reviewed correction decisions to this D&D campaign transcript.",
    "Preserve timestamps, line order, original language, and conversational style.",
    "Use the raw transcript only as a reference when the corrected transcript appears wrong.",
    "Remove obvious speech-to-text repetition loops where the same phrase repeats many times.",
    "Do not summarize. Output only the reviewed corrected transcript Markdown.",
    "",
    "<campaign-glossary>",
    options.glossary,
    "</campaign-glossary>",
    "",
    "<human-reviewed-decisions>",
    JSON.stringify(options.decisions, null, 2),
    "</human-reviewed-decisions>",
    "",
    "<correction-notes>",
    options.correctionNotes,
    "</correction-notes>",
    "",
    "<raw-transcript>",
    options.rawTranscript,
    "</raw-transcript>",
    "",
    "<corrected-transcript>",
    options.correctedTranscript,
    "</corrected-transcript>",
  ].join("\n");
}

export function buildAnnotatedCorrectionNotes(correctionNotes: string): string {
  return [
    "# Annotated Correction Notes",
    "",
    "## Annotation Instructions",
    "",
    "- Add decisions directly under uncertain items.",
    "- Use lines like `DECISION: <wrong text> -> <canonical text>` for confirmed corrections.",
    "- Use `ALIAS: <observed transcript text> -> <canonical term>` for reusable aliases.",
    "- Use `UNRESOLVED:` for items that should remain uncertain.",
    "- Add context notes freely; the next correction pass will use this annotated file for each transcript chunk.",
    "",
    "## Original Correction Notes",
    "",
    correctionNotes.trim(),
    "",
  ].join("\n");
}

export function buildApplyAnnotatedCorrectionsPrompt(options: {
  glossary: string;
  rawTranscript: string;
  correctedTranscript: string;
  annotatedCorrectionNotes: string;
}): string {
  return [
    "Apply this annotated correction review to this D&D campaign transcript.",
    "Preserve timestamps, line order, original language, and conversational style.",
    "Use `DECISION:` and `ALIAS:` lines as authoritative human review decisions.",
    "Use `UNRESOLVED:` lines as warnings; do not invent unsupported corrections.",
    "Use the raw transcript only as a reference when the corrected transcript appears wrong.",
    "Remove obvious speech-to-text repetition loops where the same phrase repeats many times.",
    "Do not summarize. Output only the reviewed corrected transcript Markdown.",
    "",
    "<campaign-glossary>",
    options.glossary,
    "</campaign-glossary>",
    "",
    "<annotated-correction-review>",
    options.annotatedCorrectionNotes,
    "</annotated-correction-review>",
    "",
    "<raw-transcript>",
    options.rawTranscript,
    "</raw-transcript>",
    "",
    "<corrected-transcript>",
    options.correctedTranscript,
    "</corrected-transcript>",
  ].join("\n");
}

async function codexExecToFile(cwd: string, prompt: string, outputPath: string): Promise<void> {
  await runCommand("codex", ["exec", "--sandbox", "read-only", "-C", cwd, "-o", outputPath, "-"], {
    cwd,
    input: prompt,
  });
}

async function reviewNotesPrompt(outDir: string): Promise<CorrectionDecision[]> {
  const correctionNotesPath = join(outDir, "correction_notes.md");
  const correctionNotes = await readFile(correctionNotesPath, "utf8");
  const rl = createInterface({ input, output });
  const decisions: CorrectionDecision[] = [];

  try {
    output.write(`\nReview correction notes:\n\n${correctionNotes}\n`);
    output.write("\nEnter correction decisions. Leave original blank when finished.\n");
    while (true) {
      const original = (await rl.question("\nOriginal/uncertain text: ")).trim();
      if (!original) {
        break;
      }
      const actionRaw = (await rl.question("Action [accept/reject/edit/skip/context]: ")).trim().toLowerCase();
      const action = ["accept", "reject", "edit", "skip", "context"].includes(actionRaw)
        ? actionRaw as CorrectionAction
        : "skip";
      const correction = action === "edit"
        ? (await rl.question("Canonical correction: ")).trim()
        : undefined;
      const applyGlobally = action === "edit"
        ? (await rl.question("Apply globally and save alias? [y/N]: ")).trim().toLowerCase().startsWith("y")
        : undefined;
      const note = (await rl.question("Note/context (optional): ")).trim() || undefined;
      decisions.push(normalizeCorrectionDecision({ action, original, correction, applyGlobally, note }));
    }
  } finally {
    rl.close();
  }

  return decisions;
}

async function writeReviewArtifacts(outDir: string, decisions: CorrectionDecision[]): Promise<{
  answersPath: string;
  aliasesPath: string;
  unresolvedPath: string;
}> {
  const reviewDir = join(outDir, "review");
  await mkdir(reviewDir, { recursive: true });
  const answersPath = join(reviewDir, "correction_answers.json");
  const aliasesPath = join(reviewDir, "correction_aliases.json");
  const unresolvedPath = join(reviewDir, "unresolved_corrections.md");
  const aliases = decisions.flatMap((decision) => decision.alias ? [decision.alias] : []);
  const unresolved = decisions.filter((decision) => decision.action === "skip" || decision.action === "context");

  await writeFile(answersPath, `${JSON.stringify({ decisions }, null, 2)}\n`, "utf8");
  await writeFile(aliasesPath, `${JSON.stringify({ aliases }, null, 2)}\n`, "utf8");
  await writeFile(
    unresolvedPath,
    unresolved.length
      ? [`# Unresolved Corrections`, "", ...unresolved.map((decision) => `- ${decision.original}${decision.note ? `: ${decision.note}` : ""}`), ""].join("\n")
      : "# Unresolved Corrections\n\nNone.\n",
    "utf8",
  );

  return { answersPath, aliasesPath, unresolvedPath };
}

async function readDecisions(path: string): Promise<CorrectionDecision[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as { decisions?: CorrectionDecisionInput[] };
  return (parsed.decisions ?? []).map(normalizeCorrectionDecision);
}

async function openEditor(command: string, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(`${command} ${JSON.stringify(path)}`, {
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Editor exited with code ${code}`));
    });
  });
}

export function resolveEditorCommand(explicitEditor: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return explicitEditor?.trim() || env["VISUAL"]?.trim() || env["EDITOR"]?.trim() || undefined;
}

export function reviewedTranscriptionDirFor(outDir: string): string {
  return join(outDir, "reviewed_transcription");
}

async function listTranscriptChunkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries
    .filter((entry) => /^session_\d+\.md$/.test(entry))
    .map((entry) => join(dir, entry))
    .sort(naturalTranscriptChunkSort);
}

async function generateReviewedChunk(options: {
  backend: CorrectionBackend;
  cwd: string;
  glossary: string;
  rawChunk: string;
  correctedChunk: string;
  annotatedCorrectionNotes: string;
  outputPath: string;
  ollamaUrl: string;
  model: string;
}): Promise<void> {
  const prompt = buildApplyAnnotatedCorrectionsPrompt({
    glossary: options.glossary,
    rawTranscript: options.rawChunk,
    correctedTranscript: options.correctedChunk,
    annotatedCorrectionNotes: options.annotatedCorrectionNotes,
  });

  if (options.backend === "ollama") {
    const reviewed = await generateWithOllama({
      baseUrl: options.ollamaUrl,
      model: options.model,
      prompt,
    });
    await writeFile(options.outputPath, `${reviewed.trim()}\n`, "utf8");
    return;
  }

  await codexExecToFile(options.cwd, prompt, options.outputPath);
}

export const applyCorrectionsCommand = buildCommand({
  async func(this: LocalContext, flags: ApplyCorrectionFlags, outDirArg: string) {
    const cwd = this.currentPath;
    const outDir = outDirArg.startsWith("/") ? outDirArg : join(cwd, outDirArg);
    const rawTranscriptPath = join(outDir, "raw_transcript.md");
    const correctedTranscriptPath = join(outDir, "corrected_transcript.md");
    const correctionNotesPath = join(outDir, "correction_notes.md");
    const glossaryPath = join(outDir, "context", "glossary.md");
    const correctedTranscriptionDir = correctedTranscriptionDirFor(outDir);
    const rawTranscriptionDir = join(outDir, "raw_transcription");
    const annotatedPath = flags.annotated
      ? flags.annotated.startsWith("/") ? flags.annotated : join(cwd, flags.annotated)
      : join(outDir, "review", "correction_notes.annotated.md");
    const reviewedTranscriptPath = join(outDir, "corrected_transcript.reviewed.md");

    for (const path of [rawTranscriptPath, correctedTranscriptPath, correctionNotesPath]) {
      if (!(await exists(path))) {
        throw new Error(`Missing required artifact: ${path}`);
      }
    }

    if (!flags.apply) {
      if (!(await exists(annotatedPath))) {
        await mkdir(dirname(annotatedPath), { recursive: true });
        await writeFile(annotatedPath, buildAnnotatedCorrectionNotes(await readFile(correctionNotesPath, "utf8")), "utf8");
      }
      const editor = resolveEditorCommand(flags.editor);
      if (editor) {
        await openEditor(editor, annotatedPath);
      }
      this.process.stdout.write(`Annotated correction notes ready at ${annotatedPath}\n`);
      this.process.stdout.write(`After editing, run with --apply to generate ${reviewedTranscriptPath}\n`);
      return;
    }

    if (!(await exists(annotatedPath))) {
      throw new Error(`Missing annotated correction notes: ${annotatedPath}`);
    }

    const glossary = await exists(glossaryPath) ? await readFile(glossaryPath, "utf8") : "";
    const annotatedCorrectionNotes = await readFile(annotatedPath, "utf8");

    if (await exists(correctedTranscriptionDir)) {
      const reviewedTranscriptionDir = reviewedTranscriptionDirFor(outDir);
      await mkdir(reviewedTranscriptionDir, { recursive: true });
      const correctedChunkPaths = await listTranscriptChunkFiles(correctedTranscriptionDir);
      if (correctedChunkPaths.length === 0) {
        throw new Error(`No corrected transcript chunks found in ${correctedTranscriptionDir}`);
      }

      for (const correctedChunkPath of correctedChunkPaths) {
        const chunkName = basename(correctedChunkPath);
        const reviewedChunkPath = join(reviewedTranscriptionDir, chunkName);
        if (!flags.force && await exists(reviewedChunkPath)) {
          continue;
        }
        const rawChunkPath = join(rawTranscriptionDir, chunkName);
        await generateReviewedChunk({
          backend: flags["correction-backend"],
          cwd,
          glossary,
          rawChunk: await exists(rawChunkPath) ? await readFile(rawChunkPath, "utf8") : "",
          correctedChunk: await readFile(correctedChunkPath, "utf8"),
          annotatedCorrectionNotes,
          outputPath: reviewedChunkPath,
          ollamaUrl: flags["ollama-url"],
          model: flags["correction-model"],
        });
      }

      const reviewedChunks = await Promise.all(
        correctedChunkPaths.map((chunkPath) => {
          return readFile(join(reviewedTranscriptionDir, basename(chunkPath)), "utf8");
        }),
      );
      await writeFile(reviewedTranscriptPath, joinCorrectedTranscriptChunks(reviewedChunks), "utf8");
    } else {
      const prompt = buildApplyAnnotatedCorrectionsPrompt({
        glossary,
        rawTranscript: await readFile(rawTranscriptPath, "utf8"),
        correctedTranscript: await readFile(correctedTranscriptPath, "utf8"),
        annotatedCorrectionNotes,
      });
      if (flags["correction-backend"] === "ollama") {
        const reviewed = await generateWithOllama({
          baseUrl: flags["ollama-url"],
          model: flags["correction-model"],
          prompt,
        });
        await writeFile(reviewedTranscriptPath, `${reviewed.trim()}\n`, "utf8");
      } else {
        await codexExecToFile(cwd, prompt, reviewedTranscriptPath);
      }
    }

    this.process.stdout.write(`Reviewed transcript written to ${reviewedTranscriptPath}\n`);
  },
  parameters: {
    flags,
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Transcript output directory, e.g. astro/.bf-transcripts/session1",
        },
      ],
    },
  },
  docs: {
    brief: "Prepare annotated correction notes or apply them to produce a reviewed transcript",
  },
});
