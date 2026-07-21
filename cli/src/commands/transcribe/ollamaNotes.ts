import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { buildNotesFrontmatter } from "./notes.js";

export interface OllamaNotesOptions {
  campaign: string;
  sessionDate: string;
  transcriptPath: string;
  correctionNotesPath?: string;
  contextExcerpt: string;
  correctionRules?: string;
  notesPath: string;
  outDir: string;
  model: string;
  baseUrl: string;
  chunkChars: number;
  sceneGroupSize: number;
  force: boolean;
  resume: boolean;
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

export function splitTextByLines(text: string, maxChars: number): string[] {
  if (maxChars <= 0) {
    throw new Error("maxChars must be greater than 0");
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const line of text.split("\n")) {
    const additionalLength = current.length === 0 ? line.length : line.length + 1;
    if (current.length > 0 && currentLength + additionalLength > maxChars) {
      chunks.push(current.join("\n").trim());
      current = [];
      currentLength = 0;
    }

    current.push(line);
    currentLength += currentLength === 0 ? line.length : line.length + 1;
  }

  const finalChunk = current.join("\n").trim();
  if (finalChunk) {
    chunks.push(finalChunk);
  }
  return chunks.filter(Boolean);
}

function stripMarkdownFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:mdx|markdown|md)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

function correctionRulesSection(correctionRules: string | undefined): string[] {
  return [
    "<correction-rules>",
    correctionRules?.trim() || "None.",
    "</correction-rules>",
  ];
}

export async function generateWithOllama(options: {
  baseUrl: string;
  model: string;
  prompt: string;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(new URL("/api/generate", options.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        prompt: options.prompt,
        stream: false,
        options: {
          temperature: 0.2,
        },
      }),
    });
  } catch (error) {
    throw new Error(
      `Could not connect to Ollama at ${options.baseUrl}. Start Ollama with "ollama serve" and ensure the model is installed with "ollama pull ${options.model}".`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new Error(`Ollama request failed with ${response.status}: ${await response.text()}`);
  }

  const parsed = await response.json() as OllamaGenerateResponse;
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return parsed.response?.trim() ?? "";
}

async function writeGeneratedFile(options: {
  path: string;
  force: boolean;
  resume: boolean;
  generate: () => Promise<string>;
}): Promise<string> {
  if (options.resume && !options.force && await exists(options.path)) {
    return readFile(options.path, "utf8");
  }

  const generated = await options.generate();
  await mkdir(dirname(options.path), { recursive: true });
  await writeFile(options.path, `${generated.trim()}\n`, "utf8");
  return generated;
}

export async function runOllamaHierarchicalNotes(options: OllamaNotesOptions): Promise<void> {
  const transcript = await readFile(options.transcriptPath, "utf8");
  const correctionNotes = options.correctionNotesPath && await exists(options.correctionNotesPath)
    ? await readFile(options.correctionNotesPath, "utf8")
    : "";
  const frontmatter = buildNotesFrontmatter({
    campaign: options.campaign,
    sessionDate: options.sessionDate,
  });

  const summaryDir = join(options.outDir, "ollama_notes");
  const chunkDir = join(summaryDir, "chunks");
  const sceneDir = join(summaryDir, "scenes");
  await mkdir(chunkDir, { recursive: true });
  await mkdir(sceneDir, { recursive: true });

  const transcriptChunks = splitTextByLines(transcript, options.chunkChars);
  const chunkSummaryPaths: string[] = [];
  for (const [index, chunk] of transcriptChunks.entries()) {
    const path = join(chunkDir, `chunk_${String(index).padStart(3, "0")}.md`);
    chunkSummaryPaths.push(path);
    await writeGeneratedFile({
      path,
      force: options.force,
      resume: options.resume,
      generate: () => generateWithOllama({
        baseUrl: options.baseUrl,
        model: options.model,
        prompt: [
          "Summarize this D&D actual-play transcript chunk for later campaign notes.",
          "Preserve names, factions, locations, items, spells, decisions, unresolved hooks, and uncertainty.",
          "Treat narrated prior-session recaps as context only; exclude their events unless they recur or advance during current-session play.",
          "Remove obvious speech-to-text repetition loops. Do not invent details.",
          "Use concise bullets grouped by topic.",
          "",
          "<campaign-context>",
          options.contextExcerpt,
          "</campaign-context>",
          "",
          ...correctionRulesSection(options.correctionRules),
          "",
          "<correction-notes>",
          correctionNotes,
          "</correction-notes>",
          "",
          "<transcript-chunk>",
          chunk,
          "</transcript-chunk>",
        ].join("\n"),
      }),
    });
  }

  const chunkSummaries = await Promise.all(chunkSummaryPaths.map((path) => readFile(path, "utf8")));
  const sceneSummaryPaths: string[] = [];
  for (let index = 0; index < chunkSummaries.length; index += options.sceneGroupSize) {
    const groupIndex = index / options.sceneGroupSize;
    const group = chunkSummaries.slice(index, index + options.sceneGroupSize).join("\n\n---\n\n");
    const path = join(sceneDir, `scene_${String(groupIndex).padStart(3, "0")}.md`);
    sceneSummaryPaths.push(path);
    await writeGeneratedFile({
      path,
      force: options.force,
      resume: options.resume,
      generate: () => generateWithOllama({
        baseUrl: options.baseUrl,
        model: options.model,
        prompt: [
          "Merge these D&D campaign chunk summaries into a coherent scene summary.",
          "Deduplicate repeated information. Preserve unresolved hooks and uncertainty.",
          "Do not reintroduce events identified as prior-session recap unless current-session play revisited or advanced them.",
          "Use shared correction rules to keep settled terms settled and avoid canonizing rejected transcription artifacts.",
          "Use concise bullets grouped by topic.",
          "",
          ...correctionRulesSection(options.correctionRules),
          "",
          "<chunk-summaries>",
          group,
          "</chunk-summaries>",
        ].join("\n"),
      }),
    });
  }

  const sceneSummaries = await Promise.all(sceneSummaryPaths.map((path) => readFile(path, "utf8")));
  const finalDraftPath = join(summaryDir, "notes.mdx");
  const generated = await writeGeneratedFile({
    path: finalDraftPath,
    force: options.force,
    resume: options.resume,
    generate: () => generateWithOllama({
      baseUrl: options.baseUrl,
      model: options.model,
      prompt: [
        "Create Astro MDX campaign notes from these D&D session scene summaries.",
        "Write readable campaign notes, not a correction changelog.",
        "Use this output structure after the frontmatter:",
        "## Summary",
        "- {summary bullet}",
        "  - {optional nested detail}",
        "",
        "## Open Hooks",
        "- {hook bullet}",
        "",
        "### Confirmations Needed",
        "- {confirmation bullet}",
        "",
        "### Boundaries",
        "- {boundary bullet}",
        "",
        "Summary contains readable events from this session's play, grouped with ordinary MDX subheadings and concise nested bullets, excluding narrated prior-session recaps unless revisited or advanced.",
        "Hooks contains live unresolved story, lore, item, spell, faction, or consequence threads only.",
        "Confirmations Needed contains only live checks that need future audio, canon, or human campaign review.",
        "Boundaries contains only reader-facing interpretive constraints that remain important to future play, such as exact oath/deal wording or in-world distinctions the party should preserve.",
        "If Open Hooks, Confirmations Needed, or Boundaries have no real entries, omit the empty heading rather than adding filler.",
        "Do not wrap note sections in fenced markmap, mindmap, or other code blocks.",
        "Prioritize session events, party actions, NPCs, places, factions, lore reveals, items, spells, and live unresolved hooks.",
        "Apply settled correction rules directly in the relevant prose or bullets so the final note uses corrected names and terms.",
        "Use an Open Hooks section only for live unresolved campaign questions or confirmations that still need future review.",
        "Do not create Settled Clarifications, Do Not Canonize, Correction Notes, Transcription Notes, or similar cleanup-ledger sections.",
        "Do not include rejected ASR artifacts, table chatter exclusions, alias drift, or do-not-canonize guardrails in the final note; those belong in shared correction rules.",
        "Do not include transcript process commentary or a prose introduction.",
        "Output a complete MDX file. Use exactly this frontmatter:",
        frontmatter,
        "",
        ...correctionRulesSection(options.correctionRules),
        "",
        "<scene-summaries>",
        sceneSummaries.join("\n\n---\n\n"),
        "</scene-summaries>",
      ].join("\n"),
    }),
  });

  const mdx = stripMarkdownFence(generated);
  await mkdir(dirname(options.notesPath), { recursive: true });
  await writeFile(options.notesPath, mdx.startsWith("---") ? `${mdx.trim()}\n` : `${frontmatter}${mdx.trim()}\n`, "utf8");
}
