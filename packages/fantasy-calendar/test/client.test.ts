import assert from "node:assert/strict";
import { test } from "node:test";

import { bastionCalendar } from "@bastion-falls/calendar";
import {
	BASTION_FANTASY_CALENDAR_HASH,
	FantasyCalendarError,
	fetchFantasyCalendarDate,
} from "../src/index.js";

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}
const valid = {
	current_date: { year: 1275, timespan: 8, day: 25 },
	current_era: "AI",
	epoch_day: 459264,
};

test("fetches the exact endpoint and returns a Bastion date", async () => {
	let request: [string, RequestInit | undefined] | undefined;
	const date = await fetchFantasyCalendarDate({
		fetch: async (url, init) => {
			request = [String(url), init];
			return response(valid);
		},
		sleep: async () => undefined,
	});
	assert.equal(
		request?.[0],
		`https://app.fantasy-calendar.com/api/v1/calendar/${BASTION_FANTASY_CALENDAR_HASH}/dynamic_data`,
	);
	assert.equal(request?.[1]?.method, "GET");
	assert.deepEqual(date.fields, { era: "AI", year: 1275, month: 9, day: 25 });
	assert.equal(date.epochDay, 459264);
	assert.ok(date.isBoundTo(bastionCalendar));
});

test("maps PF and rejects unknown eras", async () => {
	const pf = await fetchFantasyCalendarDate({
		fetch: async () =>
			response({
				current_date: { year: 1, timespan: 0, day: 1 },
				current_era: "PF",
				epoch_day: -360,
			}),
		sleep: async () => undefined,
	});
	assert.deepEqual(pf.fields, { era: "PF", year: 1, month: 1, day: 1 });
	await assert.rejects(
		() =>
			fetchFantasyCalendarDate({
				fetch: async () => response({ ...valid, current_era: "X" }),
				sleep: async () => undefined,
			}),
		(error) =>
			error instanceof FantasyCalendarError && error.category === "unknown-era",
	);
});

test("retries transient failures with bounded jitter and does not retry ordinary 4xx", async () => {
	let calls = 0;
	const delays: number[] = [];
	const date = await fetchFantasyCalendarDate({
		retries: 2,
		fetch: async () => {
			calls++;
			return calls === 1 ? response({}, 503) : response(valid);
		},
		random: () => 0.5,
		sleep: async (ms) => {
			delays.push(ms);
		},
	});
	assert.equal(date.epochDay, 459264);
	assert.equal(calls, 2);
	assert.deepEqual(delays, [150]);
	calls = 0;
	await assert.rejects(
		() =>
			fetchFantasyCalendarDate({
				retries: 3,
				fetch: async () => {
					calls++;
					return response({}, 404);
				},
				sleep: async () => undefined,
			}),
		/HTTP 404/,
	);
	assert.equal(calls, 1);
});

test("retries network errors and preserves structured failure details", async () => {
	let calls = 0;
	const now = (() => {
		let t = 100;
		return () => (t += 7);
	})();
	await assert.rejects(
		() =>
			fetchFantasyCalendarDate({
				retries: 1,
				fetch: async () => {
					calls++;
					throw new Error("offline");
				},
				sleep: async () => undefined,
				now,
			}),
		(error) => {
			assert.ok(error instanceof FantasyCalendarError);
			assert.equal(error.category, "network");
			assert.equal(error.attempts, 2);
			assert.equal(error.elapsedMs, 14);
			return true;
		},
	);
	assert.equal(calls, 2);
});

test("rejects malformed payload and date/epoch disagreement without retry", async () => {
	let calls = 0;
	await assert.rejects(
		() =>
			fetchFantasyCalendarDate({
				retries: 3,
				fetch: async () => {
					calls++;
					return response({ ...valid, epoch_day: 1 });
				},
				sleep: async () => undefined,
			}),
		/epoch/i,
	);
	assert.equal(calls, 1);
});

test("covers timeout, 429, exhaustion, malformed JSON, schema, and invalid date as structured failures", async () => {
	const cases: Array<{
		name: string;
		fetch: () => Promise<Response>;
		category: FantasyCalendarError["category"];
		attempts: number;
	}> = [
		{
			name: "timeout",
			fetch: async () => {
				throw new DOMException("timed out", "TimeoutError");
			},
			category: "timeout",
			attempts: 3,
		},
		{
			name: "429",
			fetch: async () => response({}, 429),
			category: "http",
			attempts: 3,
		},
		{
			name: "5xx exhaustion",
			fetch: async () => response({}, 503),
			category: "http",
			attempts: 3,
		},
		{
			name: "malformed JSON",
			fetch: async () => new Response("{", { status: 200 }),
			category: "schema",
			attempts: 1,
		},
		{
			name: "schema",
			fetch: async () => response({ nope: true }),
			category: "schema",
			attempts: 1,
		},
		{
			name: "invalid date",
			fetch: async () =>
				response({
					current_date: { year: 1275, timespan: 8, day: 99 },
					current_era: "AI",
					epoch_day: 459264,
				}),
			category: "schema",
			attempts: 1,
		},
	];
	for (const item of cases) {
		await assert.rejects(
			() =>
				fetchFantasyCalendarDate({
					retries: 2,
					fetch: item.fetch,
					sleep: async () => undefined,
					random: () => 0.5,
				}),
			(error: unknown) => {
				assert.ok(error instanceof FantasyCalendarError, item.name);
				if (!(error instanceof FantasyCalendarError)) return false;
				assert.equal(error.category, item.category, item.name);
				assert.equal(error.attempts, item.attempts, item.name);
				return true;
			},
		);
	}
});

test("uses jitter endpoints and rejects invalid option/callback boundaries", async () => {
	for (const [random, expected] of [
		[0, 100],
		[1, 200],
	] as const) {
		const delays: number[] = [];
		await assert.rejects(
			() =>
				fetchFantasyCalendarDate({
					retries: 1,
					fetch: async () => response({}, 503),
					random: () => random,
					sleep: async (ms: number) => {
						delays.push(ms);
					},
				}),
			/HTTP 503/,
		);
		assert.deepEqual(delays, [expected]);
	}
	for (const options of [
		null,
		[],
		1,
		{ timeoutMs: null },
		{ retries: undefined },
		{ fetch: null },
		{ sleep: 1 },
		{ random: 1 },
		{ now: "now" },
	] as unknown[]) {
		await assert.rejects(
			() => fetchFantasyCalendarDate(options as never),
			/options|timeoutMs|retries|fetch|sleep|random|now/i,
		);
	}
	await assert.rejects(
		() =>
			fetchFantasyCalendarDate({
				fetch: async () => response({}, 503),
				random: () => NaN,
				sleep: async () => undefined,
			}),
		(error: unknown) =>
			error instanceof FantasyCalendarError &&
			(error as FantasyCalendarError).category === "configuration",
	);
	await assert.rejects(
		() =>
			fetchFantasyCalendarDate({
				fetch: async () => response(valid),
				now: () => Infinity,
			}),
		(error: unknown) =>
			error instanceof FantasyCalendarError &&
			(error as FantasyCalendarError).category === "configuration",
	);

	let nowCalls = 0;
	await assert.rejects(
		() =>
			fetchFantasyCalendarDate({
				fetch: async () => response({ nope: true }),
				now: () => {
					nowCalls += 1;
					if (nowCalls === 1) return 100;
					throw new Error("clock failed");
				},
			}),
		(error: unknown) => {
			assert.ok(error instanceof FantasyCalendarError);
			if (!(error instanceof FantasyCalendarError)) return false;
			return error.category === "configuration" && error.attempts === 1;
		},
	);
});
