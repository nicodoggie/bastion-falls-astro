import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { buildNotesFrontmatter } from "./notes.js";
import { runCommand } from "./process.js";

export interface CodexCorrectionOptions {
	cwd: string;
	transcriptPath: string;
	glossaryPath: string;
	correctedTranscriptPath: string;
	correctionNotesPath: string;
	rawTranscriptionDir?: string;
	force?: boolean;
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

async function codexExecToFile(
	cwd: string,
	prompt: string,
	outputPath: string,
): Promise<void> {
	await runCommand(
		"codex",
		["exec", "--sandbox", "read-only", "-C", cwd, "-o", outputPath, "-"],
		{
			cwd,
			input: prompt,
		},
	);
}

async function exists(path: string): Promise<boolean> {
	try {
		await readFile(path, "utf8");
		return true;
	} catch {
		return false;
	}
}

function transcriptChunkIndex(path: string): number {
	const match = /session_(\d+)\.md$/.exec(basename(path));
	return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function naturalTranscriptChunkSort(a: string, b: string): number {
	const indexDelta = transcriptChunkIndex(a) - transcriptChunkIndex(b);
	return indexDelta === 0 ? a.localeCompare(b) : indexDelta;
}

export function joinCorrectedTranscriptChunks(chunks: string[]): string {
	return `${chunks
		.map((chunk) => chunk.trim())
		.filter(Boolean)
		.join("\n")}\n`;
}

export function correctedTranscriptionDirFor(outDir: string): string {
	return join(outDir, "corrected_transcription");
}

export function correctionNotesChunksDirFor(outDir: string): string {
	return join(outDir, "correction_notes_chunks");
}

export function joinCorrectionNoteChunks(
	chunks: Array<{ name: string; text: string }>,
): string {
	return [
		"# Correction Notes",
		"",
		...chunks.flatMap((chunk) => [
			`## ${basename(chunk.name, ".md")}`,
			"",
			chunk.text.trim() || "None.",
			"",
		]),
	].join("\n");
}

async function listRawTranscriptChunks(
	rawTranscriptionDir: string,
): Promise<string[]> {
	const entries = await readdir(rawTranscriptionDir);
	return entries
		.filter((entry) => /^session_\d+\.md$/.test(entry))
		.map((entry) => join(rawTranscriptionDir, entry))
		.sort(naturalTranscriptChunkSort);
}

async function runCodexCorrectionChunked(
	options: CodexCorrectionOptions & { rawTranscriptionDir: string },
): Promise<void> {
	const glossary = await readFile(options.glossaryPath, "utf8");
	const chunkPaths = await listRawTranscriptChunks(options.rawTranscriptionDir);
	const correctedChunksDir = correctedTranscriptionDirFor(
		dirname(options.correctedTranscriptPath),
	);
	const correctionNotesChunksDir = correctionNotesChunksDirFor(
		dirname(options.correctionNotesPath),
	);
	await mkdir(correctedChunksDir, { recursive: true });
	await mkdir(correctionNotesChunksDir, { recursive: true });

	for (const chunkPath of chunkPaths) {
		const outputPath = join(correctedChunksDir, basename(chunkPath));
		if (!options.force && (await exists(outputPath))) {
			continue;
		}

		await codexExecToFile(
			options.cwd,
			[
				"Correct this D&D campaign transcript chunk.",
				"Preserve timestamps, line order, original language, and conversational style.",
				"Only fix likely speech-to-text mistakes, especially names, places, D&D rules terms, and campaign lore terms.",
				"Do not summarize. Output only the corrected transcript Markdown for this chunk.",
				"",
				"<campaign-glossary>",
				glossary,
				"</campaign-glossary>",
				"",
				"<transcript-chunk>",
				await readFile(chunkPath, "utf8"),
				"</transcript-chunk>",
			].join("\n"),
			outputPath,
		);
	}

	const correctedChunks = await Promise.all(
		chunkPaths.map((chunkPath) =>
			readFile(join(correctedChunksDir, basename(chunkPath)), "utf8"),
		),
	);
	await writeFile(
		options.correctedTranscriptPath,
		joinCorrectedTranscriptChunks(correctedChunks),
		"utf8",
	);

	for (const chunkPath of chunkPaths) {
		const chunkName = basename(chunkPath);
		const outputPath = join(correctionNotesChunksDir, chunkName);
		if (!options.force && (await exists(outputPath))) {
			continue;
		}

		await codexExecToFile(
			options.cwd,
			[
				"Review this corrected D&D transcript chunk and produce concise correction notes.",
				"List uncertain corrections, likely names/lore terms used, and any audio/transcription ambiguity worth checking.",
				"Do not repeat the full transcript.",
				"",
				"<campaign-glossary>",
				glossary,
				"</campaign-glossary>",
				"",
				"<corrected-transcript-chunk>",
				await readFile(join(correctedChunksDir, chunkName), "utf8"),
				"</corrected-transcript-chunk>",
			].join("\n"),
			outputPath,
		);
	}

	const correctionNoteChunks = await Promise.all(
		chunkPaths.map(async (chunkPath) => {
			const name = basename(chunkPath);
			return {
				name,
				text: await readFile(join(correctionNotesChunksDir, name), "utf8"),
			};
		}),
	);
	await writeFile(
		options.correctionNotesPath,
		joinCorrectionNoteChunks(correctionNoteChunks),
		"utf8",
	);
}

export async function runCodexCorrection(
	options: CodexCorrectionOptions,
): Promise<void> {
	if (options.rawTranscriptionDir) {
		await runCodexCorrectionChunked({
			...options,
			rawTranscriptionDir: options.rawTranscriptionDir,
		});
		return;
	}

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
	const correctionNotes = options.correctionNotesPath
		? await readFile(options.correctionNotesPath, "utf8")
		: "";
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
		const mdx = generated.startsWith("---")
			? `${generated.trim()}\n`
			: `${frontmatter}${generated.trim()}\n`;
		await mkdir(dirname(options.notesPath), { recursive: true });
		await writeFile(options.notesPath, mdx, "utf8");
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}
