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
import { splitTextByLines } from "./ollamaNotes.js";
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
	transcriptChunksDir?: string;
	correctionNotesChunksDir?: string;
	contextExcerpt: string;
	notesPath: string;
	outDir?: string;
	chunkChars?: number;
	sceneGroupSize?: number;
	onProgress?: (message: string) => void;
	force?: boolean;
	resume?: boolean;
}

export interface CodexSummaryCleanupOptions {
	cwd: string;
	transcriptPath: string;
	summaryTranscriptPath: string;
	transcriptChunksDir?: string;
	outDir: string;
	chunkChars?: number;
	onProgress?: (message: string) => void;
	force?: boolean;
	resume?: boolean;
}

interface NamedTextChunk {
	name: string;
	text: string;
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

export function correctionContextChunksDirFor(outDir: string): string {
	return join(outDir, "correction_context_chunks");
}

export function codexNotesDirFor(outDir: string): string {
	return join(outDir, "codex_notes");
}

export function summaryTranscriptionDirFor(outDir: string): string {
	return join(outDir, "summary_transcription");
}

export function buildCodexRollingContextPrompt(options: {
	previousContext: string;
	latestSummary: string;
}): string {
	return [
		"Update the rolling campaign context for future D&D transcript chunks.",
		"Keep only details likely to disambiguate later speech: active locations, NPCs, factions, goals, unresolved hooks, aliases, spell/item names, and uncertain terms.",
		"Drop resolved minutiae and repeated phrasing. Keep the result concise and organized as bullets.",
		"",
		"<previous-rolling-context>",
		options.previousContext.trim() || "None yet.",
		"</previous-rolling-context>",
		"",
		"<latest-chunk-summary>",
		options.latestSummary.trim(),
		"</latest-chunk-summary>",
	].join("\n");
}

export function buildSummaryCleanupPrompt(options: {
	transcriptChunk: string;
}): string {
	return [
		"Prepare this D&D transcript chunk for downstream summarization.",
		"Preserve timestamps, line order, story meaning, speaker intent, names, and uncertainty.",
		"Use neutral, summary-safe wording for content that could trigger a policy refusal in a later notes-generation pass.",
		"Do not summarize, omit, moralize, or add new facts. Output only the cleaned transcript Markdown for this chunk.",
		"",
		"<transcript-chunk>",
		options.transcriptChunk,
		"</transcript-chunk>",
	].join("\n");
}

export function formatSummaryCleanupProgress(options: {
	status: "starting" | "finished" | "reusing";
	index: number;
	total: number;
	name: string;
}): string {
	const labels = {
		starting: "Starting",
		finished: "Finished",
		reusing: "Reusing",
	};
	return `${labels[options.status]} summary-safe transcript chunk ${options.index + 1}/${options.total}: ${options.name}\n`;
}

export function formatSummaryCleanupWriteMessage(path: string): string {
	return `Wrote summary-safe transcript: ${path}\n`;
}

export function formatSummaryCleanupJoinMessage(options: {
	count: number;
	path: string;
}): string {
	return `Joining ${options.count} summary-safe chunks into ${options.path}\n`;
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

export function joinCodexSceneSummaries(summaries: string[]): string {
	return summaries
		.map((summary) => summary.trim())
		.filter(Boolean)
		.join("\n\n---\n\n");
}

export function formatCodexNotesSceneProgress(options: {
	status: "starting" | "finished" | "reusing";
	index: number;
	total: number;
	chunkStart: number;
	chunkEnd: number;
	path: string;
}): string {
	const labels = {
		starting: "Starting",
		finished: "Finished",
		reusing: "Reusing",
	};
	return `${labels[options.status]} Codex scene summary ${options.index + 1}/${options.total} from chunks ${options.chunkStart + 1}-${options.chunkEnd + 1}: ${options.path}\n`;
}

async function listTranscriptChunks(dir: string): Promise<string[]> {
	const entries = await readdir(dir);
	return entries
		.filter((entry) => /^session_\d+\.md$/.test(entry))
		.map((entry) => join(dir, entry))
		.sort(naturalTranscriptChunkSort);
}

async function listRawTranscriptChunks(
	rawTranscriptionDir: string,
): Promise<string[]> {
	return listTranscriptChunks(rawTranscriptionDir);
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
	const correctionContextChunksDir = correctionContextChunksDirFor(
		dirname(options.correctedTranscriptPath),
	);
	await mkdir(correctedChunksDir, { recursive: true });
	await mkdir(correctionNotesChunksDir, { recursive: true });

	let rollingContext = "";
	for (const chunkPath of chunkPaths) {
		const outputPath = join(correctedChunksDir, basename(chunkPath));
		const contextPath = join(correctionContextChunksDir, basename(chunkPath));

		const correctedChunk = await writeGeneratedFile(
			{
				path: outputPath,
				force: Boolean(options.force),
				resume: true,
				generate: async () => {
					await codexExecToFile(
						options.cwd,
						[
							"Correct this D&D campaign transcript chunk.",
							"Preserve timestamps, line order, original language, and conversational style.",
							"Only fix likely speech-to-text mistakes, especially names, places, D&D rules terms, and campaign lore terms.",
							"Do not summarize. Output only the corrected transcript Markdown for this chunk.",
							"",
							"<prior-session-context>",
							rollingContext || "None yet.",
							"</prior-session-context>",
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
					return readFile(outputPath, "utf8");
				},
			},
		);
		rollingContext = await writeGeneratedFile({
			path: contextPath,
			force: Boolean(options.force),
			resume: true,
			generate: async () => {
				await codexExecToFile(
					options.cwd,
					buildCodexRollingContextPrompt({
						previousContext: rollingContext,
						latestSummary: correctedChunk,
					}),
					contextPath,
				);
				return readFile(contextPath, "utf8");
			},
		});
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

export async function writeGeneratedFile(options: {
	path: string;
	force: boolean;
	resume: boolean;
	generate: () => Promise<string>;
}): Promise<string> {
	if (options.resume && !options.force && await exists(options.path)) {
		return readFile(options.path, "utf8");
	}

	await mkdir(dirname(options.path), { recursive: true });
	const generated = await options.generate();
	await writeFile(options.path, `${generated.trim()}\n`, "utf8");
	return generated;
}

async function readTranscriptChunks(options: {
	transcriptPath: string;
	transcriptChunksDir?: string;
	chunkChars: number;
}): Promise<NamedTextChunk[]> {
	if (options.transcriptChunksDir) {
		const paths = await listTranscriptChunks(options.transcriptChunksDir);
		if (paths.length > 0) {
			return Promise.all(paths.map(async (path) => ({
				name: basename(path),
				text: await readFile(path, "utf8"),
			})));
		}
	}

	const transcript = await readFile(options.transcriptPath, "utf8");
	return splitTextByLines(transcript, options.chunkChars).map((text, index) => ({
		name: `chunk_${String(index).padStart(3, "0")}.md`,
		text,
	}));
}

export async function runCodexSummaryCleanup(
	options: CodexSummaryCleanupOptions,
): Promise<void> {
	const chunkChars = options.chunkChars ?? 12000;
	const force = Boolean(options.force);
	const resume = Boolean(options.resume);
	const transcriptChunks = await readTranscriptChunks({
		transcriptPath: options.transcriptPath,
		transcriptChunksDir: options.transcriptChunksDir,
		chunkChars,
	});
	const summaryChunksDir = summaryTranscriptionDirFor(options.outDir);
	const summaryChunkPaths: string[] = [];

	for (const [index, chunk] of transcriptChunks.entries()) {
		const outputPath = join(summaryChunksDir, chunk.name);
		summaryChunkPaths.push(outputPath);
		if (resume && !force && await exists(outputPath)) {
			options.onProgress?.(formatSummaryCleanupProgress({
				status: "reusing",
				index,
				total: transcriptChunks.length,
				name: chunk.name,
			}));
			continue;
		}
		options.onProgress?.(formatSummaryCleanupProgress({
			status: "starting",
			index,
			total: transcriptChunks.length,
			name: chunk.name,
		}));
		await writeGeneratedFile({
			path: outputPath,
			force,
			resume,
			generate: async () => {
				await codexExecToFile(
					options.cwd,
					buildSummaryCleanupPrompt({
						transcriptChunk: chunk.text,
					}),
					outputPath,
				);
				return readFile(outputPath, "utf8");
				},
			});
		options.onProgress?.(formatSummaryCleanupProgress({
			status: "finished",
			index,
			total: transcriptChunks.length,
			name: chunk.name,
		}));
	}

	const summaryChunks = await Promise.all(
		summaryChunkPaths.map((path) => readFile(path, "utf8")),
	);
	options.onProgress?.(formatSummaryCleanupJoinMessage({
		count: summaryChunks.length,
		path: options.summaryTranscriptPath,
	}));
	await writeFile(
		options.summaryTranscriptPath,
		joinCorrectedTranscriptChunks(summaryChunks),
		"utf8",
	);
	options.onProgress?.(formatSummaryCleanupWriteMessage(options.summaryTranscriptPath));
}

async function readCorrectionNoteChunks(options: {
	correctionNotesPath?: string;
	correctionNotesChunksDir?: string;
}): Promise<Map<string, string>> {
	const notesByName = new Map<string, string>();
	if (options.correctionNotesChunksDir) {
		const paths = await listTranscriptChunks(options.correctionNotesChunksDir);
		await Promise.all(paths.map(async (path) => {
			notesByName.set(basename(path), await readFile(path, "utf8"));
		}));
	}
	if (notesByName.size === 0 && options.correctionNotesPath) {
		notesByName.set("*", await readFile(options.correctionNotesPath, "utf8"));
	}
	return notesByName;
}

export async function runCodexNotes(options: CodexNotesOptions): Promise<void> {
	const chunkChars = options.chunkChars ?? 12000;
	const sceneGroupSize = options.sceneGroupSize ?? 5;
	const force = Boolean(options.force);
	const resume = Boolean(options.resume);
	const frontmatter = buildNotesFrontmatter({
		campaign: options.campaign,
		sessionDate: options.sessionDate,
	});
	const transcriptChunks = await readTranscriptChunks({
		transcriptPath: options.transcriptPath,
		transcriptChunksDir: options.transcriptChunksDir,
		chunkChars,
	});
	const correctionNotes = await readCorrectionNoteChunks({
		correctionNotesPath: options.correctionNotesPath,
		correctionNotesChunksDir: options.correctionNotesChunksDir,
	});
	const workspaceDir = options.outDir
		? codexNotesDirFor(options.outDir)
		: await mkdtemp(join(tmpdir(), "bf-transcribe-notes-"));
	const chunkDir = join(workspaceDir, "chunks");
	const rollingContextDir = join(workspaceDir, "rolling_context");
	const sceneDir = join(workspaceDir, "scenes");
	const finalDraftPath = join(workspaceDir, "notes.mdx");

	try {
		const chunkSummaryPaths: string[] = [];
		let rollingContext = "";
		for (const [index, chunk] of transcriptChunks.entries()) {
			const path = join(chunkDir, `chunk_${String(index).padStart(3, "0")}.md`);
			const rollingContextPath = join(rollingContextDir, `context_${String(index).padStart(3, "0")}.md`);
			chunkSummaryPaths.push(path);
			const chunkCorrectionNotes = correctionNotes.get(chunk.name) ?? correctionNotes.get("*") ?? "";
			const chunkSummary = await writeGeneratedFile({
				path,
				force,
				resume,
				generate: async () => {
					await codexExecToFile(
						options.cwd,
						[
							"Compact this corrected D&D session transcript chunk for later campaign-note generation.",
							"Preserve session events, party actions, NPCs, places, factions, lore reveals, items, spells, unresolved hooks, and uncertainty.",
							"Remove timestamps and obvious speech-to-text repetition loops. Do not invent details.",
							"Use concise bullets grouped by topic.",
							"",
							"<prior-session-context>",
							rollingContext || "None yet.",
							"</prior-session-context>",
							"",
							"<campaign-context>",
							options.contextExcerpt,
							"</campaign-context>",
							"",
							"<correction-notes>",
							chunkCorrectionNotes,
							"</correction-notes>",
							"",
							"<transcript-chunk>",
							chunk.text,
							"</transcript-chunk>",
						].join("\n"),
						path,
					);
					return readFile(path, "utf8");
				},
			});
			rollingContext = await writeGeneratedFile({
				path: rollingContextPath,
				force,
				resume,
				generate: async () => {
					await codexExecToFile(
						options.cwd,
						buildCodexRollingContextPrompt({
							previousContext: rollingContext,
							latestSummary: chunkSummary,
						}),
						rollingContextPath,
					);
					return readFile(rollingContextPath, "utf8");
				},
			});
		}

		const chunkSummaries = await Promise.all(chunkSummaryPaths.map((path) => readFile(path, "utf8")));
		const sceneSummaryPaths: string[] = [];
		const sceneCount = Math.ceil(chunkSummaries.length / sceneGroupSize);
		for (let index = 0; index < chunkSummaries.length; index += sceneGroupSize) {
			const groupIndex = index / sceneGroupSize;
			const path = join(sceneDir, `scene_${String(groupIndex).padStart(3, "0")}.md`);
			sceneSummaryPaths.push(path);
			const group = chunkSummaries.slice(index, index + sceneGroupSize);
			const progress = {
				index: groupIndex,
				total: sceneCount,
				chunkStart: index,
				chunkEnd: index + group.length - 1,
				path,
			};
			if (resume && !force && await exists(path)) {
				options.onProgress?.(formatCodexNotesSceneProgress({
					status: "reusing",
					...progress,
				}));
				continue;
			}
			options.onProgress?.(formatCodexNotesSceneProgress({
				status: "starting",
				...progress,
			}));
			await writeGeneratedFile({
				path,
				force,
				resume,
				generate: async () => {
					await codexExecToFile(
						options.cwd,
						[
							"Merge these compacted D&D campaign transcript summaries into a coherent scene summary.",
							"Deduplicate repeated information. Preserve unresolved hooks and uncertainty.",
							"Use concise bullets grouped by topic.",
							"",
							"<chunk-summaries>",
							group.join("\n\n---\n\n"),
							"</chunk-summaries>",
						].join("\n"),
						path,
					);
					return readFile(path, "utf8");
				},
			});
			options.onProgress?.(formatCodexNotesSceneProgress({
				status: "finished",
				...progress,
			}));
		}

		const sceneSummaries = await Promise.all(sceneSummaryPaths.map((path) => readFile(path, "utf8")));
		const generated = await writeGeneratedFile({
			path: finalDraftPath,
			force,
			resume,
			generate: async () => {
				await codexExecToFile(
					options.cwd,
					[
						"Create Astro MDX campaign notes from these D&D session scene summaries.",
						"Match the style of the existing Bastion Falls session notes: multiple fenced markmap blocks, concise headings, nested bullets.",
						"Prioritize session events, party actions, NPCs, places, factions, lore reveals, items, spells, and unresolved hooks.",
						"Do not include timestamps, transcript process commentary, or a prose introduction.",
						"Output a complete MDX file. Use exactly this frontmatter:",
						frontmatter,
						"",
						"<scene-summaries>",
						joinCodexSceneSummaries(sceneSummaries),
						"</scene-summaries>",
					].join("\n"),
					finalDraftPath,
				);
				return readFile(finalDraftPath, "utf8");
			},
		});
		const stripped = stripMarkdownFence(generated);
		const mdx = stripped.startsWith("---")
			? `${stripped.trim()}\n`
			: `${frontmatter}${stripped.trim()}\n`;
		await mkdir(dirname(options.notesPath), { recursive: true });
		await writeFile(options.notesPath, mdx, "utf8");
	} finally {
		if (!options.outDir) {
			await rm(workspaceDir, { recursive: true, force: true });
		}
	}
}
