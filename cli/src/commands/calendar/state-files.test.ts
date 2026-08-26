import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	open as openFile,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	resolveCalendarStatePaths,
	writeCalendarStateAtomically,
} from "./state-files.js";

async function tempDestination(): Promise<{ dir: string; path: string }> {
	const dir = await mkdtemp(join(tmpdir(), "calendar-state-"));
	return { dir, path: join(dir, "nested", "state.json") };
}

const valid = { z: 1, a: "ok" };

test("atomic writer creates parents, writes stable JSON, and renames a claimed temp", async () => {
	const { path } = await tempDestination();
	await writeCalendarStateAtomically(path, valid);
	assert.equal(await readFile(path, "utf8"), '{\n  "a": "ok",\n  "z": 1\n}\n');
});

test("atomic writer rejects an existing sibling temp without deleting it", async () => {
	const { path } = await tempDestination();
	const temp = `${path}.fixed.tmp`;
	await mkdir(dirname(temp), { recursive: true });
	await writeFile(temp, "keep", "utf8");
	await assert.rejects(
		writeCalendarStateAtomically(path, valid, { tempPath: temp }),
		(error: NodeJS.ErrnoException) => error.code === "EEXIST",
	);
	assert.equal(await readFile(temp, "utf8"), "keep");
});

test("claimed partial temp is cleaned after write, beforeRename, and rename failures", async (t) => {
	const cases = [
		[
			"write",
			async (path: string, temp: string) => {
				const sentinel = new Error("write failed");
				return writeCalendarStateAtomically(path, valid, {
					tempPath: temp,
					open: async (claimed: string, flags: "wx") => {
						const handle = await openFile(claimed, flags);
						return {
							writeFile: async (data: string) => {
								await handle.write(data.slice(0, 5));
								assert.equal(await readFile(claimed, "utf8"), data.slice(0, 5));
								throw sentinel;
							},
							close: () => handle.close(),
						};
					},
				});
			},
		],
		[
			"beforeRename",
			async (path: string, temp: string) =>
				writeCalendarStateAtomically(path, valid, {
					tempPath: temp,
					beforeRename: async () => {
						throw new Error("before rename failed");
					},
				}),
		],
		[
			"rename",
			async (path: string, temp: string) =>
				writeCalendarStateAtomically(path, valid, {
					tempPath: temp,
					rename: async () => {
						throw new Error("rename failed");
					},
				}),
		],
	] as const;
	for (const [name, run] of cases) {
		await t.test(name, async () => {
			const { path } = await tempDestination();
			const temp = `${path}.${name}.tmp`;
			await assert.rejects(run(path, temp));
			await assert.rejects(readFile(temp));
		});
	}
});

test("first close failure is propagated after cleanup close and temp removal", async () => {
	const { path } = await tempDestination();
	const temp = `${path}.close.tmp`;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, "old", "utf8");
	const primary = new Error("close failed");
	let closes = 0;
	await assert.rejects(
		writeCalendarStateAtomically(path, valid, {
			tempPath: temp,
			open: async (claimed: string, flags: "wx") => {
				const handle = await openFile(claimed, flags);
				return {
					writeFile: async (data: string) => {
						await handle.write(data);
					},
					close: async () => {
						closes++;
						if (closes === 1) throw primary;
						await handle.close();
					},
				};
			},
		}),
		primary,
	);
	assert.equal(closes, 2);
	await assert.rejects(stat(temp));
	assert.equal(await readFile(path, "utf8"), "old");
});

test("rename failure preserves pre-existing destination bytes", async () => {
	const { path } = await tempDestination();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, "old", { encoding: "utf8" });
	await assert.rejects(
		writeCalendarStateAtomically(path, valid, {
			rename: async () => {
				throw new Error("rename failed");
			},
		}),
	);
	assert.equal(await readFile(path, "utf8"), "old");
});

test("repository discovery works from nested paths and uses exact default paths", async () => {
	const root = dirname(process.cwd());
	const paths = await resolveCalendarStatePaths(
		join(process.cwd(), "src", "commands"),
	);
	assert.equal(paths.repositoryRoot, root);
	assert.equal(
		paths.fallbackPath,
		join(root, "astro/src/data/bastion-calendar-state.json"),
	);
	assert.equal(
		paths.resolvedPath,
		join(root, "astro/.astro/bastion-calendar-state.json"),
	);
});

test("atomic writer rejects malformed destination, options, temp path, and values", async () => {
	await assert.rejects(
		writeCalendarStateAtomically("relative", valid),
		TypeError,
	);
	await assert.rejects(
		writeCalendarStateAtomically(join(tmpdir(), "x"), valid, null as never),
		TypeError,
	);
	await assert.rejects(
		writeCalendarStateAtomically(join(tmpdir(), "x"), valid, {
			tempPath: join(tmpdir(), "other", "x"),
		}),
		TypeError,
	);
	await assert.rejects(
		writeCalendarStateAtomically(join(tmpdir(), "x"), { bad: undefined }),
		TypeError,
	);
});
