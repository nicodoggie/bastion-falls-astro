import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	buildHermesReviewArgs,
	buildHermesReviewPrompt,
	hermesReviewNotesDirFor,
	parseHermesReviewResponse,
	reconciledTranscriptionDirFor,
	runHermesTranscriptReview,
} from "./hermesReview.js";

test("uses separate Hermes reconciliation artifact directories", () => {
	assert.equal(
		reconciledTranscriptionDirFor("/tmp/session"),
		"/tmp/session/reconciled_transcription",
	);
	assert.equal(
		hermesReviewNotesDirFor("/tmp/session"),
		"/tmp/session/hermes_review_notes",
	);
});

test("builds an evidence-oriented read-only reconciliation prompt", () => {
	const prompt = buildHermesReviewPrompt({
		campaign: "the-vengeful",
		sessionDate: "2026-07-12",
		chunkName: "session_004.md",
		rawTranscript: "[00:01] Illegal E. Bear",
		correctedTranscript: "[00:01] Legally Bare",
		correctionNotes: "- ship name uncertain",
	});

	assert.match(prompt, /read and search repository evidence/i);
	assert.match(
		prompt,
		/Do not edit, patch, create, move, or delete repository files/i,
	);
	assert.match(
		prompt,
		/Do not use the current session's authored note or generated summaries as evidence/i,
	);
	assert.match(prompt, /preserve timestamps, line order/i);
	assert.match(prompt, /<raw-transcript>/);
	assert.match(prompt, /Illegal E\. Bear/);
	assert.match(prompt, /<codex-corrected-transcript>/);
	assert.match(prompt, /<codex-correction-notes>/);
	assert.match(prompt, /<reconciled-transcript>/);
	assert.match(prompt, /<review-notes>/);
});

test("builds Hermes CLI arguments with an optional profile", () => {
	const prompt = "review this";
	assert.deepEqual(
		buildHermesReviewArgs({ prompt, profile: "bf-review", maxTurns: 9 }),
		[
			"--profile",
			"bf-review",
			"chat",
			"-Q",
			"--source",
			"tool",
			"-t",
			"file",
			"-s",
			"bastion-note-review-corrections,bastion-transcript-evidence-workflows",
			"--max-turns",
			"9",
			"-q",
			prompt,
		],
	);
	assert.equal(
		buildHermesReviewArgs({ prompt, maxTurns: 12 }).includes("--profile"),
		false,
	);
});

test("parses a valid tagged Hermes review response", () => {
	assert.deepEqual(
		parseHermesReviewResponse(`
<reconciled-transcript>
[00:01] Illegally Bear
</reconciled-transcript>
<review-notes>
- [00:01] Confirmed from corrections.yaml.
</review-notes>
`),
		{
			reconciledTranscript: "[00:01] Illegally Bear",
			reviewNotes: "- [00:01] Confirmed from corrections.yaml.",
		},
	);
});

test("rejects malformed Hermes review responses", () => {
	assert.throws(
		() => parseHermesReviewResponse("plain text"),
		/exactly one reconciled-transcript section/,
	);
	assert.throws(
		() =>
			parseHermesReviewResponse(`
<reconciled-transcript></reconciled-transcript>
<review-notes>None.</review-notes>
`),
		/reconciled-transcript section must not be empty/,
	);
	assert.throws(
		() =>
			parseHermesReviewResponse(`
extra
<reconciled-transcript>text</reconciled-transcript>
<review-notes>None.</review-notes>
`),
		/outside the tagged sections/,
	);
});

test("writes resumable per-chunk and joined Hermes review artifacts", async () => {
	const dir = await mkdtemp(join(tmpdir(), "bf-hermes-review-"));
	const rawDir = join(dir, "raw_transcription");
	const correctedDir = join(dir, "corrected_transcription");
	const notesDir = join(dir, "correction_notes_chunks");
	await Promise.all([
		mkdir(rawDir, { recursive: true }),
		mkdir(correctedDir, { recursive: true }),
		mkdir(notesDir, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(rawDir, "session_000.md"), "[00:01] Illegal E. Bear\n"),
		writeFile(join(correctedDir, "session_000.md"), "[00:01] Legally Bare\n"),
		writeFile(join(notesDir, "session_000.md"), "- ship uncertain\n"),
	]);

	let calls = 0;
	const commandRunner = async () => {
		calls += 1;
		return {
			stdout: `<reconciled-transcript>\n[00:01] Illegally Bear\n</reconciled-transcript>\n<review-notes>\nNone.\n</review-notes>\n`,
			stderr: "",
		};
	};

	try {
		const paths = await runHermesTranscriptReview({
			cwd: "/repo",
			campaign: "the-vengeful",
			sessionDate: "2026-07-12",
			rawTranscriptionDir: rawDir,
			correctedTranscriptionDir: correctedDir,
			correctionNotesChunksDir: notesDir,
			outDir: dir,
			reconciledTranscriptPath: join(dir, "reconciled_transcript.md"),
			reviewNotesPath: join(dir, "hermes_review_notes.md"),
			maxTurns: 12,
			resume: true,
			force: false,
			commandRunner,
		});

		assert.equal(calls, 1);
		assert.equal(
			await readFile(
				join(dir, "reconciled_transcription/session_000.md"),
				"utf8",
			),
			"[00:01] Illegally Bear\n",
		);
		assert.match(
			await readFile(paths.reviewNotesPath, "utf8"),
			/## session_000/,
		);
		assert.equal(
			await readFile(paths.reconciledTranscriptPath, "utf8"),
			"[00:01] Illegally Bear\n",
		);

		await runHermesTranscriptReview({
			cwd: "/repo",
			campaign: "the-vengeful",
			sessionDate: "2026-07-12",
			rawTranscriptionDir: rawDir,
			correctedTranscriptionDir: correctedDir,
			correctionNotesChunksDir: notesDir,
			outDir: dir,
			reconciledTranscriptPath: join(dir, "reconciled_transcript.md"),
			reviewNotesPath: join(dir, "hermes_review_notes.md"),
			maxTurns: 12,
			resume: true,
			force: false,
			commandRunner,
		});
		assert.equal(calls, 1);

		await runHermesTranscriptReview({
			cwd: "/repo",
			campaign: "the-vengeful",
			sessionDate: "2026-07-12",
			rawTranscriptionDir: rawDir,
			correctedTranscriptionDir: correctedDir,
			correctionNotesChunksDir: notesDir,
			outDir: dir,
			reconciledTranscriptPath: join(dir, "reconciled_transcript.md"),
			reviewNotesPath: join(dir, "hermes_review_notes.md"),
			maxTurns: 12,
			resume: true,
			force: true,
			commandRunner,
		});
		assert.equal(calls, 2);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("preserves invalid Hermes output in a diagnostic file", async () => {
	const dir = await mkdtemp(join(tmpdir(), "bf-hermes-review-invalid-"));
	const rawDir = join(dir, "raw_transcription");
	const correctedDir = join(dir, "corrected_transcription");
	const notesDir = join(dir, "correction_notes_chunks");
	await Promise.all([
		mkdir(rawDir, { recursive: true }),
		mkdir(correctedDir, { recursive: true }),
		mkdir(notesDir, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(rawDir, "session_000.md"), "raw\n"),
		writeFile(join(correctedDir, "session_000.md"), "corrected\n"),
		writeFile(join(notesDir, "session_000.md"), "notes\n"),
	]);

	try {
		await assert.rejects(
			() =>
				runHermesTranscriptReview({
					cwd: "/repo",
					campaign: "the-vengeful",
					sessionDate: "2026-07-12",
					rawTranscriptionDir: rawDir,
					correctedTranscriptionDir: correctedDir,
					correctionNotesChunksDir: notesDir,
					outDir: dir,
					reconciledTranscriptPath: join(dir, "reconciled_transcript.md"),
					reviewNotesPath: join(dir, "hermes_review_notes.md"),
					maxTurns: 12,
					resume: false,
					force: false,
					commandRunner: async () => ({ stdout: "bad response", stderr: "" }),
				}),
			/session_000\.md/,
		);
		assert.equal(
			await readFile(
				join(dir, "hermes_review_diagnostics/session_000.txt"),
				"utf8",
			),
			"bad response\n",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("reports the chunk when Hermes cannot run", async () => {
	const dir = await mkdtemp(join(tmpdir(), "bf-hermes-review-command-"));
	const rawDir = join(dir, "raw_transcription");
	const correctedDir = join(dir, "corrected_transcription");
	const notesDir = join(dir, "correction_notes_chunks");
	await Promise.all([
		mkdir(rawDir, { recursive: true }),
		mkdir(correctedDir, { recursive: true }),
		mkdir(notesDir, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(rawDir, "session_000.md"), "raw\n"),
		writeFile(join(correctedDir, "session_000.md"), "corrected\n"),
		writeFile(join(notesDir, "session_000.md"), "notes\n"),
	]);

	try {
		await assert.rejects(
			() =>
				runHermesTranscriptReview({
					cwd: "/repo",
					campaign: "the-vengeful",
					sessionDate: "2026-07-12",
					rawTranscriptionDir: rawDir,
					correctedTranscriptionDir: correctedDir,
					correctionNotesChunksDir: notesDir,
					outDir: dir,
					reconciledTranscriptPath: join(dir, "reconciled_transcript.md"),
					reviewNotesPath: join(dir, "hermes_review_notes.md"),
					maxTurns: 12,
					resume: false,
					force: false,
					commandRunner: async () => {
						throw new Error("spawn hermes ENOENT");
					},
				}),
			/Hermes review failed for session_000\.md.*Ensure the Hermes CLI is installed/s,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
