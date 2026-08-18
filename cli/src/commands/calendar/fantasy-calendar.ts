import { BastionDate, type CalendarDate } from "@bastion-falls/calendar";
import { z } from "zod";
import { DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS } from "./settings.js";

export const BASTION_FANTASY_CALENDAR_HASH = "089e518f9ea966373b1c71535c25b98a";

const ENDPOINT = `https://app.fantasy-calendar.com/api/v1/calendar/${BASTION_FANTASY_CALENDAR_HASH}/dynamic_data`;
const responseSchema = z.object({
	current_date: z.object({
		year: z.number().int(),
		timespan: z.number().int(),
		day: z.number().int(),
	}),
	current_era: z.string(),
	epoch_day: z.number().int(),
});

export type FantasyCalendarFailureCategory =
	| "network"
	| "timeout"
	| "http"
	| "schema"
	| "unknown-era"
	| "date-epoch-disagreement"
	| "configuration";

export class FantasyCalendarError extends Error {
	readonly category: FantasyCalendarFailureCategory;
	attempts: number;
	elapsedMs: number;
	readonly status?: number;

	constructor(
		category: FantasyCalendarFailureCategory,
		message: string,
		attempts: number,
		elapsedMs: number,
		status?: number,
	) {
		super(message);
		this.name = "FantasyCalendarError";
		this.category = category;
		this.attempts = attempts;
		this.elapsedMs = elapsedMs;
		if (status !== undefined) this.status = status;
	}
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export interface FantasyCalendarFetchOptions {
	readonly timeoutMs?: number;
	readonly retries?: number;
	readonly fetch?: FetchLike;
	readonly sleep?: (milliseconds: number) => Promise<void> | void;
	readonly random?: () => number;
	readonly now?: () => number;
}

function elapsed(start: number, now: () => number, attempts: number): number {
	try {
		const value = now();
		if (!Number.isFinite(value))
			throw new Error("now returned a non-finite value");
		return Math.max(0, Math.round(value - start));
	} catch {
		throw new FantasyCalendarError(
			"configuration",
			"Fantasy Calendar clock callback failed",
			attempts,
			0,
		);
	}
}
function transient(failure: FantasyCalendarError): boolean {
	return (
		failure.category === "network" ||
		failure.category === "timeout" ||
		(failure.category === "http" &&
			(failure.status === 429 ||
				(failure.status !== undefined && failure.status >= 500)))
	);
}

function optionRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError("options must be an object");
	}
	return value as Record<string, unknown>;
}
function own(options: Record<string, unknown>, key: string): boolean {
	return Object.hasOwn(options, key);
}
function callback<T extends (...args: never[]) => unknown>(
	options: Record<string, unknown>,
	key: string,
	fallback: T,
): T {
	const value = own(options, key) ? options[key] : fallback;
	if (typeof value !== "function")
		throw new TypeError(`${key} must be a function`);
	return value as T;
}

export async function fetchFantasyCalendarDate(
	options: FantasyCalendarFetchOptions = {},
): Promise<CalendarDate> {
	const input = optionRecord(options);
	const timeoutMs = own(input, "timeoutMs")
		? input["timeoutMs"]
		: DEFAULT_TIMEOUT_MS;
	const retries = own(input, "retries") ? input["retries"] : DEFAULT_RETRIES;
	if (
		typeof timeoutMs !== "number" ||
		!Number.isFinite(timeoutMs) ||
		!Number.isInteger(timeoutMs) ||
		timeoutMs < 100 ||
		timeoutMs > 10_000
	)
		throw new RangeError("timeoutMs is out of range");
	if (
		typeof retries !== "number" ||
		!Number.isFinite(retries) ||
		!Number.isInteger(retries) ||
		retries < 0 ||
		retries > 3
	)
		throw new RangeError("retries is out of range");
	const fetchImpl = callback(input, "fetch", fetch) as FetchLike;
	const sleep = callback(
		input,
		"sleep",
		(milliseconds: number) =>
			new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
	) as (milliseconds: number) => Promise<void> | void;
	const random = callback(input, "random", Math.random) as () => number;
	const now = callback(input, "now", Date.now) as () => number;
	let started: number;
	try {
		started = now();
		if (!Number.isFinite(started))
			throw new Error("now returned a non-finite value");
	} catch {
		throw new FantasyCalendarError(
			"configuration",
			"Fantasy Calendar clock callback failed",
			0,
			0,
		);
	}
	let attempts = 0;
	let last: FantasyCalendarError | undefined;

	while (attempts <= retries) {
		attempts += 1;
		try {
			let result: Response;
			try {
				result = await fetchImpl(ENDPOINT, {
					method: "GET",
					signal: AbortSignal.timeout(timeoutMs),
				});
			} catch (cause) {
				const timeout =
					(cause instanceof DOMException && cause.name === "TimeoutError") ||
					(cause instanceof Error && cause.name === "AbortError");
				throw new FantasyCalendarError(
					timeout ? "timeout" : "network",
					timeout
						? "Fantasy Calendar request timed out"
						: "Fantasy Calendar request failed",
					attempts,
					0,
				);
			}
			if (!result.ok)
				throw new FantasyCalendarError(
					"http",
					`Fantasy Calendar HTTP ${result.status}`,
					attempts,
					0,
					result.status,
				);
			let raw: unknown;
			try {
				raw = await result.json();
			} catch {
				throw new FantasyCalendarError(
					"schema",
					"Fantasy Calendar returned malformed JSON",
					attempts,
					elapsed(started, now, attempts),
				);
			}
			const parsed = responseSchema.safeParse(raw);
			if (!parsed.success)
				throw new FantasyCalendarError(
					"schema",
					"Fantasy Calendar response failed schema validation",
					attempts,
					elapsed(started, now, attempts),
				);
			const {
				current_date: remoteDate,
				current_era: era,
				epoch_day: epochDay,
			} = parsed.data;
			if (era !== "PF" && era !== "AI")
				throw new FantasyCalendarError(
					"unknown-era",
					`Fantasy Calendar returned unknown era ${era}`,
					attempts,
					elapsed(started, now, attempts),
				);
			let date: CalendarDate;
			try {
				date = BastionDate.from({
					era,
					year: remoteDate.year,
					month: remoteDate.timespan + 1,
					day: remoteDate.day,
				});
			} catch {
				throw new FantasyCalendarError(
					"schema",
					"Fantasy Calendar returned an invalid date",
					attempts,
					elapsed(started, now, attempts),
				);
			}
			if (date.epochDay !== epochDay)
				throw new FantasyCalendarError(
					"date-epoch-disagreement",
					"Fantasy Calendar date disagrees with epoch_day",
					attempts,
					elapsed(started, now, attempts),
				);
			return date;
		} catch (cause) {
			let failure: FantasyCalendarError;
			if (cause instanceof FantasyCalendarError) failure = cause;
			else
				failure = new FantasyCalendarError(
					"configuration",
					"Fantasy Calendar callback failed",
					attempts,
					elapsed(started, now, attempts),
				);
			failure.attempts = attempts;
			failure.elapsedMs = elapsed(started, now, attempts);
			last = failure;
			if (!transient(failure) || attempts > retries) throw failure;
			let jitter: number;
			try {
				jitter = random();
				if (!Number.isFinite(jitter))
					throw new Error("random returned a non-finite value");
			} catch {
				throw new FantasyCalendarError(
					"configuration",
					"Fantasy Calendar jitter callback failed",
					attempts,
					elapsed(started, now, attempts),
				);
			}
			const delay = 100 + Math.round(Math.min(1, Math.max(0, jitter)) * 100);
			try {
				await sleep(delay);
			} catch {
				throw new FantasyCalendarError(
					"configuration",
					"Fantasy Calendar sleeper callback failed",
					attempts,
					elapsed(started, now, attempts),
				);
			}
		}
	}
	throw (
		last ??
		new FantasyCalendarError(
			"network",
			"Fantasy Calendar request failed",
			attempts,
			elapsed(started, now, attempts),
		)
	);
}

export { ENDPOINT as BASTION_FANTASY_CALENDAR_ENDPOINT };
