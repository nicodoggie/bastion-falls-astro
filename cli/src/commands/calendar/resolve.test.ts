import assert from "node:assert/strict";
import { test } from "node:test";
import {
	bastionCalendar,
	serializeCalendarState,
} from "@bastion-falls/calendar";
import {
	BASTION_FANTASY_CALENDAR_ENDPOINT,
	BASTION_FANTASY_CALENDAR_HASH,
} from "./fantasy-calendar.js";
import { resolveCalendarState } from "./resolve.js";

const liveDate = bastionCalendar.dateFrom({
	era: "AI",
	year: 1,
	month: 1,
	day: 1,
});
const fallback = serializeCalendarState(
	bastionCalendar,
	{
		provider: "fantasy-calendar",
		identifier: BASTION_FANTASY_CALENDAR_HASH,
		endpoint: BASTION_FANTASY_CALENDAR_ENDPOINT,
	},
	bastionCalendar.dateFrom({ era: "AI", year: 2, month: 3, day: 4 }),
	"2025-01-02T03:04:05.000Z",
	{ source: "fallback-fixture" },
);

function harness(overrides: Record<string, unknown> = {}) {
	const writes: unknown[] = [];
	const warnings: unknown[] = [];
	return {
		writes,
		warnings,
		options: {
			paths: {
				repositoryRoot: "/repo",
				fallbackPath: "/repo/fallback.json",
				resolvedPath: "/repo/resolved.json",
			},
			fetchLive: async () => liveDate,
			readFallback: async () => fallback,
			writeOutput: async (_path: string, state: unknown) => {
				writes.push(state);
			},
			now: () => new Date("2026-01-01T00:00:00.000Z"),
			warn: (warning: unknown) => {
				warnings.push(warning);
			},
			...overrides,
		},
	};
}

test("live success writes exactly once and does not read fallback", async () => {
	const h = harness({
		readFallback: async () => {
			throw new Error("must not read");
		},
	});
	const result = await resolveCalendarState(h.options);
	assert.equal(result.source, "live");
	assert.equal(h.writes.length, 1);
	assert.equal(h.writes[0], result.state);
});

test("remote failure writes fallback once and emits exact warning", async () => {
	const h = harness({
		fetchLive: async () => {
			throw Object.assign(new Error("down"), {
				category: "network",
				attempts: 3,
				elapsedMs: 17,
			});
		},
		now: (() => {
			let n = 1000;
			return () => {
				n += 25;
				return new Date(n);
			};
		})(),
	});
	const result = await resolveCalendarState(h.options);
	assert.equal(result.source, "fallback");
	assert.equal(h.writes.length, 1);
	assert.deepEqual(result.warning, {
		category: "network",
		attempts: 3,
		elapsedMs: 25,
		selectedFallbackDate: "2-03-04 AI",
		fallbackRetrievedAt: "2025-01-02T03:04:05.000Z",
	});
	assert.deepEqual(h.warnings, [result.warning]);
});

test("offline does not fetch and writes fallback once", async () => {
	let fetches = 0;
	const h = harness({
		offline: true,
		fetchLive: async () => {
			fetches++;
			return liveDate;
		},
	});
	const result = await resolveCalendarState(h.options);
	assert.equal(fetches, 0);
	assert.equal(h.writes.length, 1);
	assert.equal(result.warning?.category, "offline");
	assert.equal(result.warning?.attempts, 0);
});

test("invalid live result falls back, while invalid fallback plus valid live succeeds", async () => {
	const bad = harness({ fetchLive: async () => ({ nope: true }) as never });
	assert.equal((await resolveCalendarState(bad.options)).source, "fallback");
	const missing = harness({ fetchLive: async () => undefined as never });
	assert.equal(
		(await resolveCalendarState(missing.options)).source,
		"fallback",
	);
	assert.equal(missing.writes.length, 1);
	const live = harness({
		readFallback: async () => {
			throw new Error("bad fallback");
		},
	});
	assert.equal((await resolveCalendarState(live.options)).source, "live");
	assert.equal(live.writes.length, 1);
});

test("valid live state write failure propagates without fallback read or retry", async () => {
	let reads = 0;
	let writes = 0;
	const sentinel = new Error("live write failed");
	const h = harness({
		readFallback: async () => {
			reads++;
			return fallback;
		},
		writeOutput: async () => {
			writes++;
			throw sentinel;
		},
	});
	await assert.rejects(resolveCalendarState(h.options), sentinel);
	assert.equal(reads, 0);
	assert.equal(writes, 1);
});

test("live and fallback invalid propagates aggregate failure and performs zero writes", async () => {
	const h = harness({
		fetchLive: async () => ({ nope: true }) as never,
		readFallback: async () => ({ also: "bad" }),
	});
	await assert.rejects(resolveCalendarState(h.options), AggregateError);
	assert.equal(h.writes.length, 0);
});

test("primitive live and fallback failures stay aggregate failures without writes", async () => {
	for (const liveFailure of [null, undefined, "live", 7, Symbol("live")]) {
		const h = harness({
			fetchLive: async () => {
				throw liveFailure;
			},
			readFallback: async () => {
				throw "fallback";
			},
		});
		await assert.rejects(resolveCalendarState(h.options), AggregateError);
		assert.equal(h.writes.length, 0);
	}
});

test("fallback fixture bytes are only read, never rewritten or mutated", async () => {
	const bytes = JSON.stringify(fallback);
	const h = harness({ readFallback: async () => bytes });
	const result = await resolveCalendarState({ ...h.options, offline: true });
	assert.deepEqual(result.state, fallback);
	assert.equal(h.writes.length, 1);
	assert.deepEqual(h.writes[0], fallback);
	assert.equal(bytes, JSON.stringify(fallback));
});

test("injected clock controls retrieval timestamp and elapsed time", async () => {
	let clockCalls = 0;
	const h = harness({
		now: () => {
			clockCalls++;
			return new Date("2030-05-06T07:08:09.000Z");
		},
		fetchLive: async () => {
			throw new Error("x");
		},
	});
	const result = await resolveCalendarState(h.options);
	assert.equal(clockCalls, 2);
	assert.equal(result.warning?.elapsedMs, 0);
	const live = harness({ now: () => new Date("2030-05-06T07:08:09.000Z") });
	assert.equal(
		(await resolveCalendarState(live.options)).state.retrievedAt,
		"2030-05-06T07:08:09.000Z",
	);
});

test("warn is omitted safely and fallback write failure emits no warning", async () => {
	const omitted = harness({
		fetchLive: async () => {
			throw new Error("down");
		},
		warn: undefined,
	});
	await resolveCalendarState(omitted.options);
	assert.deepEqual(omitted.warnings, []);

	const failed = harness({
		fetchLive: async () => {
			throw new Error("down");
		},
		writeOutput: async () => {
			throw new Error("fallback write failed");
		},
	});
	await assert.rejects(
		resolveCalendarState(failed.options),
		/fallback write failed/,
	);
	assert.deepEqual(failed.warnings, []);
});

test("invalid options, callbacks, and clocks fail deliberately", async () => {
	await assert.rejects(resolveCalendarState(null as never), TypeError);
	await assert.rejects(
		resolveCalendarState({ now: 1 } as never),
		/now must be a function/,
	);
	await assert.rejects(
		resolveCalendarState({ readFallback: 1 } as never),
		/readFallback must be a function/,
	);
	await assert.rejects(
		resolveCalendarState({ writeOutput: 1 } as never),
		/writeOutput must be a function/,
	);
	await assert.rejects(
		resolveCalendarState({ fetchLive: 1 } as never),
		/fetchLive must be a function/,
	);
	await assert.rejects(
		resolveCalendarState({ warn: null } as never),
		/warn must be a function/,
	);
	await assert.rejects(
		resolveCalendarState({ now: () => "not-a-date" }),
		/valid date/,
	);
});
