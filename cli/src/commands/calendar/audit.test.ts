import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
	BastionDate,
	bastionCalendar,
	serializeCalendarState,
} from "@bastion-falls/calendar";
import type { LocalContext } from "../../context.js";
import auditCommand, { classifyCharacterAge } from "./audit.js";

const current = bastionCalendar.dateFrom({
	era: "AI",
	year: 100,
	month: 3,
	day: 15,
});
const classify = (details: unknown) =>
	classifyCharacterAge({ file: "character.mdx", details }, current);

test("classifies age audit evidence across all categories", () => {
	const cases: [string, unknown, string, number | undefined][] = [
		["derived", { dateOfBirth: "90-03-14 AI" }, "derived-only", 10],
		[
			"matching",
			{ age: 10, dateOfBirth: "90-03-14 AI" },
			"matching-override",
			10,
		],
		[
			"conflicting",
			{ age: 11, dateOfBirth: "90-03-14 AI" },
			"conflicting-override",
			10,
		],
		[
			"partial",
			{ dateOfBirth: "90-03 AI" },
			"insufficient-precision",
			undefined,
		],
		["missing", { dateOfBirth: "   " }, "missing-date", undefined],
		["invalid", { dateOfBirth: "not-a-date" }, "invalid", undefined],
		["future", { dateOfBirth: "101-03-15 AI" }, "invalid", undefined],
		[
			"dead",
			{
				dateOfBirth: "90-01-01 AI",
				dateOfDeath: "95-01-01 AI",
				mortality: "dead",
			},
			"derived-only",
			5,
		],
		[
			"dead-missing",
			{ dateOfBirth: "90-01-01 AI", mortality: "dead" },
			"missing-date",
			undefined,
		],
		[
			"death-before-birth",
			{
				dateOfBirth: "90-01-01 AI",
				dateOfDeath: "89-01-01 AI",
				mortality: "dead",
			},
			"invalid",
			undefined,
		],
		["zero", { age: 0, dateOfBirth: "100-03-15 AI" }, "matching-override", 0],
		["malformed", "bad", "invalid", undefined],
	];
	for (const [name, details, category, derivedAge] of cases) {
		const result = classify(details);
		assert.equal(result.category, category, name);
		assert.equal(result.derivedAge, derivedAge, name);
	}

	const matching = classify({ age: 10, dateOfBirth: "90-03-14 AI" });
	assert.deepEqual(matching, {
		file: "character.mdx",
		category: "matching-override",
		authoredAge: 10,
		derivedAge: 10,
		dateOfBirth: "90-03-14 AI",
	});
	const dead = classify({
		dateOfBirth: "90-01-01 AI",
		dateOfDeath: "95-01-01 AI",
		mortality: "dead",
	});
	assert.deepEqual(dead, {
		file: "character.mdx",
		category: "derived-only",
		derivedAge: 5,
		dateOfBirth: "90-01-01 AI",
		dateOfDeath: "95-01-01 AI",
		mortality: "dead",
	});
	assert.equal(
		classify({ age: 20, dateOfBirth: "90-03 AI" }).reason,
		"age requires day-precision dates",
	);
});

test("authored override never hides partial or invalid dates", () => {
	assert.equal(
		classify({ age: 20, dateOfBirth: "90-03 AI" }).category,
		"insufficient-precision",
	);
	assert.equal(
		classify({ age: 20, dateOfBirth: "invalid" }).category,
		"invalid",
	);
});

async function snapshotFiles(
	root: string,
): Promise<Record<string, { hash: string; bytes: Buffer }>> {
	const result: Record<string, { hash: string; bytes: Buffer }> = {};
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else {
				const bytes = await readFile(path);
				result[relative(root, path).split("\\").join("/")] = {
					hash: createHash("sha256").update(bytes).digest("hex"),
					bytes,
				};
			}
		}
	}
	await visit(root);
	return result;
}

test("audit command discovers characters and performs no writes", async () => {
	const root = await mkdtemp(join(os.tmpdir(), "bastion-calendar-audit-"));
	try {
		await mkdir(join(root, "astro/.astro"), { recursive: true });
		await mkdir(join(root, "astro/src/content/docs/world/characters"), {
			recursive: true,
		});
		await writeFile(
			join(root, "pnpm-workspace.yaml"),
			"packages:\n  - astro\n",
		);
		await writeFile(
			join(root, "astro/.astro/bastion-calendar-state.json"),
			`${JSON.stringify(
				serializeCalendarState(
					bastionCalendar,
					{
						provider: "test",
						identifier: "audit",
						endpoint: "https://example.test",
					},
					BastionDate.from({ era: "AI", year: 100, month: 3, day: 15 }),
					"2026-08-19T00:00:00.000Z",
					{ source: "test" },
				),
				null,
				2,
			)}\n`,
		);
		const files: Record<string, string> = {
			"zeta.mdx": `---\ncharacter:\n  details:\n    age: 10\n    dateOfBirth: 90-03-14 AI\n---\n# Zeta\n`,
			"alpha.mdx": `---\ncharacter:\n  details:\n    age: 11\n    dateOfBirth: 90-03-14 AI\n---\n# Alpha\n`,
			"mu.mdx": `---\ncharacter:\n  details:\n    dateOfBirth: 90-03 AI\n---\n# Mu\n`,
		};
		for (const [name, contents] of Object.entries(files))
			await writeFile(
				join(root, "astro/src/content/docs/world/characters", name),
				contents,
			);

		const before = await snapshotFiles(root);
		let stdout = "";
		const context = {
			currentPath: root,
			process: {
				stdout: {
					write(chunk: string) {
						stdout += chunk;
						return true;
					},
				},
			},
		} as unknown as LocalContext;
		await auditCommand.call(context, { json: true });
		const after = await snapshotFiles(root);

		assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
		for (const path of Object.keys(before)) {
			assert.equal(after[path]?.hash, before[path]?.hash, path);
			assert.deepEqual(after[path]?.bytes, before[path]?.bytes, path);
		}
		const records = JSON.parse(stdout);
		assert.deepEqual(
			records.map((item: { file: string }) => item.file),
			[
				"astro/src/content/docs/world/characters/alpha.mdx",
				"astro/src/content/docs/world/characters/mu.mdx",
				"astro/src/content/docs/world/characters/zeta.mdx",
			],
		);
		assert.deepEqual(
			records.map((item: { category: string }) => item.category),
			["conflicting-override", "insufficient-precision", "matching-override"],
		);
		assert.deepEqual(records[0], {
			file: "astro/src/content/docs/world/characters/alpha.mdx",
			category: "conflicting-override",
			authoredAge: 11,
			derivedAge: 10,
			dateOfBirth: "90-03-14 AI",
		});
		assert.equal(records[1].reason, "age requires day-precision dates");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
