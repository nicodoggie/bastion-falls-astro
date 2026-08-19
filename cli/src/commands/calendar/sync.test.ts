import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	bastionCalendar,
	serializeCalendarState,
} from "@bastion-falls/calendar";
import {
	BASTION_FANTASY_CALENDAR_ENDPOINT,
	BASTION_FANTASY_CALENDAR_HASH,
} from "@bastion-falls/fantasy-calendar";
import { writeCalendarStateAtomically } from "./state-files.js";
import { syncCalendarState } from "./sync.js";

const source = {
	provider: "fantasy-calendar",
	identifier: BASTION_FANTASY_CALENDAR_HASH,
	endpoint: BASTION_FANTASY_CALENDAR_ENDPOINT,
};
const current = serializeCalendarState(
	bastionCalendar,
	source,
	bastionCalendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 }),
	"2026-01-01T00:00:00.000Z",
	{ source: "live" },
);
function harness(overrides: Record<string, unknown> = {}) {
	const writes: unknown[] = [];
	const output: string[] = [];
	return {
		writes,
		output,
		options: {
			paths: {
				repositoryRoot: "/tmp/repo",
				fallbackPath: "/tmp/repo/state.json",
				resolvedPath: "/tmp/repo/resolved.json",
			},
			readFallback: async () => current,
			fetchLive: async () =>
				bastionCalendar.dateFrom({ era: "AI", year: 1, month: 1, day: 2 }),
			writeSnapshot: async (_path: string, state: unknown) => {
				writes.push(state);
			},
			output: (line: string) => {
				output.push(line);
			},
			now: () => "2026-01-02T00:00:00.000Z",
			...overrides,
		},
	};
}

test("changed remote state previews current then proposed before atomic write", async () => {
	const h = harness();
	const result = await syncCalendarState(h.options);
	assert.equal(result.changed, true);
	assert.deepEqual(
		h.output.map((line) => line.split("\n")[0]),
		["Current committed state", "Proposed remote state"],
	);
	assert.equal(h.writes.length, 1);
	assert.equal(h.output[0]?.includes('"day": 1'), true);
	assert.equal(h.output[1]?.includes('"day": 2'), true);
});

test("unchanged canonical state does not write, including retrievedAt-only changes", async () => {
	const h = harness({
		fetchLive: async () =>
			bastionCalendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 }),
		now: () => "2030-01-01T00:00:00.000Z",
	});
	const result = await syncCalendarState(h.options);
	assert.equal(result.changed, false);
	assert.equal(h.writes.length, 0);
	assert.deepEqual(h.output, []);
});

test("refresh metadata permits timestamp-only update", async () => {
	const h = harness({
		refreshMetadata: true,
		fetchLive: async () =>
			bastionCalendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 }),
		now: () => "2030-01-01T00:00:00.000Z",
	});
	const result = await syncCalendarState(h.options);
	assert.equal(result.changed, true);
	assert.equal(h.writes.length, 1);
	assert.equal(
		(h.writes[0] as typeof current).retrievedAt,
		"2030-01-01T00:00:00.000Z",
	);
});

test("metadata-only changes write only when refresh metadata is enabled", async () => {
	const metadataChanged = { ...current, metadata: { source: "imported" } };
	const unchanged = harness({
		readFallback: async () => metadataChanged,
		fetchLive: async () =>
			bastionCalendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 }),
	});
	const ordinaryResult = await syncCalendarState(unchanged.options);
	assert.equal(ordinaryResult.changed, false);
	assert.equal(unchanged.writes.length, 0);

	const refreshed = harness({
		readFallback: async () => metadataChanged,
		fetchLive: async () =>
			bastionCalendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 }),
		refreshMetadata: true,
	});
	const refreshedResult = await syncCalendarState(refreshed.options);
	assert.equal(refreshedResult.changed, true);
	assert.equal(refreshed.writes.length, 1);
});

test("preview output failure prevents the writer from being called", async () => {
	let writes = 0;
	const h = harness({
		writeSnapshot: async () => {
			writes += 1;
		},
		output: () => {
			throw new Error("preview failed");
		},
	});
	await assert.rejects(syncCalendarState(h.options), /preview failed/);
	assert.equal(writes, 0);
});

test("atomic replacement failure preserves exact pre-existing fallback bytes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "calendar-sync-"));
	const fallbackPath = join(directory, "state.json");
	const original = '{"preserve":"exactly"}\n';
	await writeFile(fallbackPath, original, "utf8");
	const h = harness({
		paths: {
			repositoryRoot: directory,
			fallbackPath,
			resolvedPath: join(directory, "resolved.json"),
		},
		readFallback: async () => current,
		writeSnapshot: (path: string, state: unknown) =>
			writeCalendarStateAtomically(path, state, {
				rename: async () => {
					throw new Error("rename failed");
				},
			}),
	});
	await assert.rejects(syncCalendarState(h.options), /rename failed/);
	assert.equal(await readFile(fallbackPath, "utf8"), original);
});

test("read, fetch, validation, preview, and write failures preserve the snapshot", async () => {
	for (const overrides of [
		{
			fetchLive: async () => {
				throw new Error("network");
			},
		},
		{ readFallback: async () => ({ nope: true }) },
		{ fetchLive: async () => ({ nope: true }) as never },
		{
			writeSnapshot: async () => {
				throw new Error("write");
			},
		},
	]) {
		const h = harness(overrides);
		await assert.rejects(syncCalendarState(h.options));
		assert.equal(h.writes.length, 0);
	}
});

test("malformed option and callback containers fail at the exported boundary", async () => {
	await assert.rejects(
		syncCalendarState(null as never),
		/options must be an object/,
	);
	await assert.rejects(
		syncCalendarState({ fetchLive: 1 } as never),
		/fetchLive must be a function/,
	);
	await assert.rejects(
		syncCalendarState({ output: 1 } as never),
		/output must be a function/,
	);
});
