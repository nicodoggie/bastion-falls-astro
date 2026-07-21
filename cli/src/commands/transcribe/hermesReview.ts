import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
	joinCorrectedTranscriptChunks,
	naturalTranscriptChunkSort,
} from "./codex.js";
import { type CommandResult, runCommand } from "./process.js";

const HERMES_REVIEW_SKILLS = [
	"bastion-note-review-corrections",
	"bastion-transcript-evidence-workflows",
].join(",");

export type HermesCommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string },
) => Promise<CommandResult>;

export interface HermesReviewResponse {
	reconciledTranscript: string;
	reviewNotes: string;
}

export interface HermesReviewOptions {
	cwd: string;
	campaign: string;
	sessionDate: string;
	rawTranscriptionDir: string;
	correctedTranscriptionDir: string;
	correctionNotesChunksDir: string;
	outDir: string;
	reconciledTranscriptPath: string;
	reviewNotesPath: string;
	profile?: string;
	maxTurns: number;
	resume: boolean;
	force: boolean;
	onProgress?: (message: string) => void;
	commandRunner?: HermesCommandRunner;
}

export interface HermesReviewPaths {
	reconciledTranscriptPath: string;
	reviewNotesPath: string;
	reconciledTranscriptionDir: string;
	reviewNotesChunksDir: string;
}

export function reconciledTranscriptionDirFor(outDir: string): string {
	return join(outDir, "reconciled_transcription");
}

export function hermesReviewNotesDirFor(outDir: string): string {
	return join(outDir, "hermes_review_notes");
}

function hermesReviewDiagnosticsDirFor(outDir: string): string {
	return join(outDir, "hermes_review_diagnostics");
}

async function exists(path: string): Promise<boolean> {
	try {
		await readFile(path, "utf8");
		return true;
	} catch {
		return false;
	}
}

async function listTranscriptChunks(dir: string): Promise<string[]> {
	return (await readdir(dir))
		.filter((entry) => /^session_\d+\.md$/.test(entry))
		.map((entry) => join(dir, entry))
		.sort(naturalTranscriptChunkSort);
}

export function buildHermesReviewPrompt(options: {
	campaign: string;
	sessionDate: string;
	chunkName: string;
	rawTranscript: string;
	correctedTranscript: string;
	correctionNotes: string;
}): string {
	return [
		"Reconcile this D&D transcript chunk against Bastion Falls campaign evidence.",
		"You may read and search repository evidence, including older authored notes, canonical world pages, living hooks, and shared correction rules.",
		"Do not use the current session's authored note or generated summaries as evidence; they are downstream outputs and would make this review circular. Authored-note evidence must predate the supplied session date.",
		"Do not edit, patch, create, move, or delete repository files. Return the requested tagged response only.",
		"Preserve timestamps, line order, original language, conversational style, and genuine uncertainty.",
		"Apply high-confidence canon or ASR corrections directly. Do not summarize or convert in-game mysteries into transcription questions.",
		"For unresolved ambiguity, preserve the wording and add a concise timestamped review note with evidence paths.",
		"Return exactly one non-empty <reconciled-transcript> section followed by exactly one non-empty <review-notes> section.",
		"Use None. in <review-notes> when no material ambiguity remains.",
		"",
		`<campaign>${options.campaign}</campaign>`,
		`<session-date>${options.sessionDate}</session-date>`,
		`<chunk-name>${options.chunkName}</chunk-name>`,
		"",
		"<raw-transcript>",
		options.rawTranscript,
		"</raw-transcript>",
		"",
		"<codex-corrected-transcript>",
		options.correctedTranscript,
		"</codex-corrected-transcript>",
		"",
		"<codex-correction-notes>",
		options.correctionNotes,
		"</codex-correction-notes>",
		"",
		"Required response shape:",
		"<reconciled-transcript>",
		"...timestamp-preserving Markdown...",
		"</reconciled-transcript>",
		"<review-notes>",
		"...concise Markdown or None....",
		"</review-notes>",
	].join("\n");
}

export function buildHermesReviewArgs(options: {
	prompt: string;
	profile?: string;
	maxTurns: number;
}): string[] {
	return [
		...(options.profile ? ["--profile", options.profile] : []),
		"chat",
		"-Q",
		"--source",
		"tool",
		"-t",
		"file",
		"-s",
		HERMES_REVIEW_SKILLS,
		"--max-turns",
		String(options.maxTurns),
		"-q",
		options.prompt,
	];
}

function tagCount(response: string, tag: string): number {
	return response.match(new RegExp(`<${tag}>`, "g"))?.length ?? 0;
}

export function parseHermesReviewResponse(
	response: string,
): HermesReviewResponse {
	if (tagCount(response, "reconciled-transcript") !== 1) {
		throw new Error(
			"Hermes response must contain exactly one reconciled-transcript section",
		);
	}
	if (tagCount(response, "review-notes") !== 1) {
		throw new Error(
			"Hermes response must contain exactly one review-notes section",
		);
	}

	const match =
		/^\s*<reconciled-transcript>([\s\S]*?)<\/reconciled-transcript>\s*<review-notes>([\s\S]*?)<\/review-notes>\s*$/.exec(
			response,
		);
	if (!match) {
		throw new Error(
			"Hermes response contains content outside the tagged sections",
		);
	}

	const reconciledTranscript = match[1]?.trim() ?? "";
	const reviewNotes = match[2]?.trim() ?? "";
	if (!reconciledTranscript) {
		throw new Error("Hermes reconciled-transcript section must not be empty");
	}
	if (!reviewNotes) {
		throw new Error("Hermes review-notes section must not be empty");
	}
	return { reconciledTranscript, reviewNotes };
}

function joinHermesReviewNotes(
	chunks: Array<{ name: string; text: string }>,
): string {
	return [
		"# Hermes Review Notes",
		"",
		...chunks.flatMap((chunk) => [
			`## ${basename(chunk.name, ".md")}`,
			"",
			chunk.text.trim(),
			"",
		]),
	].join("\n");
}

export async function runHermesTranscriptReview(
	options: HermesReviewOptions,
): Promise<HermesReviewPaths> {
	const commandRunner = options.commandRunner ?? runCommand;
	const chunkPaths = await listTranscriptChunks(options.rawTranscriptionDir);
	const reconciledDir = reconciledTranscriptionDirFor(options.outDir);
	const reviewNotesDir = hermesReviewNotesDirFor(options.outDir);
	const diagnosticsDir = hermesReviewDiagnosticsDirFor(options.outDir);
	await Promise.all([
		mkdir(reconciledDir, { recursive: true }),
		mkdir(reviewNotesDir, { recursive: true }),
	]);

	for (const rawChunkPath of chunkPaths) {
		const chunkName = basename(rawChunkPath);
		const reconciledPath = join(reconciledDir, chunkName);
		const reviewNotesPath = join(reviewNotesDir, chunkName);
		if (
			options.resume &&
			!options.force &&
			(await exists(reconciledPath)) &&
			(await exists(reviewNotesPath))
		) {
			options.onProgress?.(`Reusing Hermes review chunk: ${chunkName}\n`);
			continue;
		}

		options.onProgress?.(
			`Reviewing transcript chunk with Hermes: ${chunkName}\n`,
		);
		const prompt = buildHermesReviewPrompt({
			campaign: options.campaign,
			sessionDate: options.sessionDate,
			chunkName,
			rawTranscript: await readFile(rawChunkPath, "utf8"),
			correctedTranscript: await readFile(
				join(options.correctedTranscriptionDir, chunkName),
				"utf8",
			),
			correctionNotes: await readFile(
				join(options.correctionNotesChunksDir, chunkName),
				"utf8",
			),
		});
		let result: CommandResult;
		try {
			result = await commandRunner(
				"hermes",
				buildHermesReviewArgs({
					prompt,
					profile: options.profile,
					maxTurns: options.maxTurns,
				}),
				{ cwd: options.cwd },
			);
		} catch (error) {
			throw new Error(
				`Hermes review failed for ${chunkName}. Ensure the Hermes CLI is installed and the selected profile is usable.`,
				{ cause: error },
			);
		}

		let review: HermesReviewResponse;
		try {
			review = parseHermesReviewResponse(result.stdout);
		} catch (error) {
			await mkdir(diagnosticsDir, { recursive: true });
			await writeFile(
				join(diagnosticsDir, chunkName.replace(/\.md$/, ".txt")),
				`${result.stdout.trimEnd()}\n`,
				"utf8",
			);
			throw new Error(`Invalid Hermes review response for ${chunkName}`, {
				cause: error,
			});
		}
		await Promise.all([
			writeFile(reconciledPath, `${review.reconciledTranscript}\n`, "utf8"),
			writeFile(reviewNotesPath, `${review.reviewNotes}\n`, "utf8"),
		]);
	}

	const reconciledChunks = await Promise.all(
		chunkPaths.map((path) =>
			readFile(join(reconciledDir, basename(path)), "utf8"),
		),
	);
	const reviewNoteChunks = await Promise.all(
		chunkPaths.map(async (path) => {
			const name = basename(path);
			return { name, text: await readFile(join(reviewNotesDir, name), "utf8") };
		}),
	);
	await Promise.all([
		writeFile(
			options.reconciledTranscriptPath,
			joinCorrectedTranscriptChunks(reconciledChunks),
			"utf8",
		),
		writeFile(
			options.reviewNotesPath,
			joinHermesReviewNotes(reviewNoteChunks),
			"utf8",
		),
	]);

	return {
		reconciledTranscriptPath: options.reconciledTranscriptPath,
		reviewNotesPath: options.reviewNotesPath,
		reconciledTranscriptionDir: reconciledDir,
		reviewNotesChunksDir: reviewNotesDir,
	};
}
