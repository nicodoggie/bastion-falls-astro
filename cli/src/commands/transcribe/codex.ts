import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { buildNotesFrontmatter } from "./notes.js";
import { runCommand } from "./process.js";

export interface CodexCorrectionOptions {
  cwd: string;
  transcriptPath: string;
  glossaryPath: string;
  correctedTranscriptPath: string;
  correctionNotesPath: string;
}

export interface CodexNotesOptions {
  cwd: string;
  campaign: string;
  sessionDate: string;
  transcriptPath: string;
  correctionNotesPath?: string;
  contextExcerpt: string;
  notesPath: string;
}

async function codexExecToFile(cwd: string, prompt: string, outputPath: string): Promise<void> {
  await runCommand("codex", ["exec", "--sandbox", "read-only", "-C", cwd, "-o", outputPath, "-"], {
    cwd,
    input: prompt,
  });
}

export async function runCodexCorrection(options: CodexCorrectionOptions): Promise<void> {
  const transcript = await readFile(options.transcriptPath, "utf8");
  const glossary = await readFile(options.glossaryPath, "utf8");

  await codexExecToFile(
    options.cwd,
    [
      "Correct this D&D campaign transcript.",
      "Preserve timestamps, line order, original language, and conversational style.",
      "Only fix likely speech-to-text mistakes, especially names, places, D&D rules terms, and campaign lore terms.",
      "Do not summarize. Output only the corrected transcript Markdown.",
      "",
      "<campaign-glossary>",
      glossary,
      "</campaign-glossary>",
      "",
      "<transcript>",
      transcript,
      "</transcript>",
    ].join("\n"),
    options.correctedTranscriptPath,
  );

  await codexExecToFile(
    options.cwd,
    [
      "Review this corrected D&D transcript and produce concise correction notes.",
      "List uncertain corrections, likely names/lore terms used, and any audio/transcription ambiguity worth checking.",
      "Do not repeat the full transcript.",
      "",
      "<campaign-glossary>",
      glossary,
      "</campaign-glossary>",
      "",
      "<corrected-transcript>",
      await readFile(options.correctedTranscriptPath, "utf8"),
      "</corrected-transcript>",
    ].join("\n"),
    options.correctionNotesPath,
  );
}

function stripMarkdownFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:mdx|markdown|md)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export async function runCodexNotes(options: CodexNotesOptions): Promise<void> {
  const transcript = await readFile(options.transcriptPath, "utf8");
  const correctionNotes = options.correctionNotesPath ? await readFile(options.correctionNotesPath, "utf8") : "";
  const frontmatter = buildNotesFrontmatter({
    campaign: options.campaign,
    sessionDate: options.sessionDate,
  });
  const tempDir = await mkdtemp(join(tmpdir(), "bf-transcribe-notes-"));
  const tempPath = join(tempDir, "notes.mdx");

  try {
    await codexExecToFile(
      options.cwd,
      [
        "Create Astro MDX campaign notes from this corrected D&D session transcript.",
        "Match the style of the existing Bastion Falls session notes: multiple fenced markmap blocks, concise headings, nested bullets.",
        "Prioritize session events, party actions, NPCs, places, factions, lore reveals, items, spells, and unresolved hooks.",
        "Do not include timestamps, transcript process commentary, or a prose introduction.",
        "Output a complete MDX file. Use exactly this frontmatter:",
        frontmatter,
        "<campaign-context>",
        options.contextExcerpt,
        "</campaign-context>",
        "",
        "<correction-notes>",
        correctionNotes,
        "</correction-notes>",
        "",
        "<corrected-transcript>",
        transcript,
        "</corrected-transcript>",
      ].join("\n"),
      tempPath,
    );

    const generated = stripMarkdownFence(await readFile(tempPath, "utf8"));
    const mdx = generated.startsWith("---") ? `${generated.trim()}\n` : `${frontmatter}${generated.trim()}\n`;
    await mkdir(dirname(options.notesPath), { recursive: true });
    await writeFile(options.notesPath, mdx, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
