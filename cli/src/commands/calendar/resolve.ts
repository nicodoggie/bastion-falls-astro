import { readFile } from "node:fs/promises";
import {
	bastionCalendar,
	type CalendarDate,
	parseCalendarState,
	type SerializedCalendarState,
	serializeCalendarState,
} from "@bastion-falls/calendar";
import {
	BASTION_FANTASY_CALENDAR_ENDPOINT,
	BASTION_FANTASY_CALENDAR_HASH,
	type FantasyCalendarFetchOptions,
	fetchFantasyCalendarDate,
} from "@bastion-falls/fantasy-calendar";
import { type CalendarSettings, resolveCalendarSettings } from "./settings.js";
import {
	type CalendarStatePaths,
	resolveCalendarStatePaths,
	writeCalendarStateAtomically,
} from "./state-files.js";

export interface CalendarFallbackWarning {
	readonly category: string;
	readonly attempts: number;
	readonly elapsedMs: number;
	readonly selectedFallbackDate: string;
	readonly fallbackRetrievedAt: string;
}

export interface CalendarResolution {
	readonly state: SerializedCalendarState;
	readonly source: "live" | "fallback";
	readonly warning?: CalendarFallbackWarning;
}

export interface ResolveCalendarStateOptions {
	readonly currentPath?: string;
	readonly paths?: CalendarStatePaths;
	readonly settings?: CalendarSettings;
	readonly offline?: boolean;
	readonly fetchLive?: (
		options?: FantasyCalendarFetchOptions,
	) => Promise<CalendarDate>;
	readonly readFallback?: (path: string) => Promise<unknown>;
	readonly writeOutput?: (
		path: string,
		state: SerializedCalendarState,
	) => Promise<void>;
	readonly now?: () => Date | string | number;
	readonly warn?: (warning: CalendarFallbackWarning) => void;
}

function callback<T>(value: unknown, name: string, fallback: T): T {
	if (value === undefined) return fallback;
	if (typeof value !== "function")
		throw new TypeError(`${name} must be a function`);
	return value as T;
}

function retrievedAt(now: () => Date | string | number): string {
	const value = now();
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.getTime()))
		throw new TypeError("clock must return a valid date");
	return date.toISOString();
}

function clockMs(now: () => Date | string | number): number {
	const value = now();
	const date = value instanceof Date ? value : new Date(value);
	const milliseconds = date.getTime();
	if (!Number.isFinite(milliseconds))
		throw new TypeError("clock must return a valid date");
	return milliseconds;
}

function fallbackError(error: unknown): {
	category: string;
	attempts: number;
	elapsedMs: number;
} {
	const item =
		error !== null && typeof error === "object"
			? (error as Partial<{
					category: unknown;
					attempts: unknown;
					elapsedMs: unknown;
				}>)
			: {};
	return {
		category: typeof item.category === "string" ? item.category : "fallback",
		attempts:
			typeof item.attempts === "number" && Number.isFinite(item.attempts)
				? item.attempts
				: 1,
		elapsedMs:
			typeof item.elapsedMs === "number" && Number.isFinite(item.elapsedMs)
				? item.elapsedMs
				: 0,
	};
}

async function defaultRead(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

export async function resolveCalendarState(
	options: ResolveCalendarStateOptions = {},
): Promise<CalendarResolution> {
	if (
		typeof options !== "object" ||
		options === null ||
		Array.isArray(options)
	) {
		throw new TypeError("resolver options must be an object");
	}
	const paths =
		options.paths ?? (await resolveCalendarStatePaths(options.currentPath));
	const clock = callback(options.now, "now", () => new Date());
	const settings =
		options.settings ??
		resolveCalendarSettings(process.env, { offline: options.offline ?? false });
	const offline = options.offline ?? settings.offline;
	const read = callback(options.readFallback, "readFallback", defaultRead);
	const write = callback(
		options.writeOutput,
		"writeOutput",
		async (path: string, state: SerializedCalendarState) => {
			await writeCalendarStateAtomically(path, state);
		},
	);
	const emitWarning = callback<(warning: CalendarFallbackWarning) => void>(
		options.warn,
		"warn",
		() => {},
	);
	const live = callback(
		options.fetchLive,
		"fetchLive",
		(fetchOptions?: FantasyCalendarFetchOptions) =>
			fetchFantasyCalendarDate({
				...fetchOptions,
				timeoutMs: settings.timeoutMs,
				retries: settings.retries,
			}),
	);
	let liveFailure: unknown;
	if (!offline) {
		let date: CalendarDate | undefined;
		try {
			date = await live({
				timeoutMs: settings.timeoutMs,
				retries: settings.retries,
			});
			if (date === undefined) throw new TypeError("live date is required");
		} catch (error) {
			liveFailure = error;
		}
		if (date !== undefined) {
			const liveDate = date;
			const retrieved = retrievedAt(clock);
			let state: SerializedCalendarState | undefined;
			let liveValidated = false;
			try {
				state = serializeCalendarState(
					bastionCalendar,
					{
						provider: "fantasy-calendar",
						identifier: BASTION_FANTASY_CALENDAR_HASH,
						endpoint: BASTION_FANTASY_CALENDAR_ENDPOINT,
					},
					liveDate,
					retrieved,
					{ source: "live" },
				);
				liveValidated = true;
			} catch (error) {
				liveFailure = error;
			}
			if (liveValidated && state !== undefined) {
				await write(paths.resolvedPath, state);
				return { state, source: "live" };
			}
		}
	} else {
		liveFailure = Object.assign(new Error("offline"), {
			category: "offline",
			attempts: 0,
			elapsedMs: 0,
		});
	}

	const started = clockMs(clock);
	let fallback: SerializedCalendarState;
	try {
		const raw = await read(paths.fallbackPath);
		fallback = parseCalendarState(
			bastionCalendar,
			typeof raw === "string" ? JSON.parse(raw) : raw,
		);
	} catch (error) {
		const first = fallbackError(liveFailure);
		const second = fallbackError(error);
		throw new AggregateError(
			[liveFailure, error],
			`live and fallback calendar state are invalid (${first.category}/${second.category})`,
		);
	}
	const failure = fallbackError(liveFailure);
	const warning: CalendarFallbackWarning = {
		...failure,
		elapsedMs: Math.max(
			failure.elapsedMs,
			Math.max(0, clockMs(clock) - started),
		),
		selectedFallbackDate: bastionCalendar.dateFrom(fallback.date).toString(),
		fallbackRetrievedAt: fallback.retrievedAt,
	};
	await write(paths.resolvedPath, fallback);
	emitWarning(warning);
	return { state: fallback, source: "fallback", warning };
}
