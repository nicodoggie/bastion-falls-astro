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
import type { LocalContext } from "@/context.js";
import { type CalendarSettings, resolveCalendarSettings } from "./settings.js";
import {
	type CalendarStatePaths,
	resolveCalendarStatePaths,
	writeCalendarStateAtomically,
} from "./state-files.js";

export interface SyncCalendarStateOptions {
	readonly currentPath?: string;
	readonly paths?: CalendarStatePaths;
	readonly settings?: CalendarSettings;
	readonly timeoutMs?: unknown;
	readonly retries?: unknown;
	readonly refreshMetadata?: unknown;
	readonly readFallback?: (path: string) => Promise<unknown>;
	readonly fetchLive?: (
		options?: FantasyCalendarFetchOptions,
	) => Promise<CalendarDate>;
	readonly writeSnapshot?: (
		path: string,
		state: SerializedCalendarState,
	) => Promise<void>;
	readonly output?: (record: string) => void;
	readonly now?: () => Date | string | number;
}

export interface CalendarSyncResult {
	readonly changed: boolean;
	readonly current: SerializedCalendarState;
	readonly proposed: SerializedCalendarState;
}

function callback<T>(value: unknown, name: string, fallback: T): T {
	if (value === undefined) return fallback;
	if (typeof value !== "function")
		throw new TypeError(`${name} must be a function`);
	return value as T;
}

function objectOptions(value: unknown): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError("sync options must be an object");
	}
}

function timestamp(now: () => Date | string | number): string {
	const value = now();
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.getTime()))
		throw new TypeError("clock must return a valid date");
	return date.toISOString();
}

function stable(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stable);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value as Record<string, unknown>)
				.sort()
				.map((key) => [key, stable((value as Record<string, unknown>)[key])]),
		);
	}
	return value;
}

function canonical(
	state: SerializedCalendarState,
	includeMetadata: boolean,
): string {
	const value = { ...state } as Record<string, unknown> & {
		retrievedAt?: unknown;
		metadata?: unknown;
	};
	delete value.retrievedAt;
	if (!includeMetadata) delete value.metadata;
	return JSON.stringify(stable(value));
}

function preview(label: string, state: SerializedCalendarState): string {
	return `${label}\n${JSON.stringify(stable(state), null, 2)}`;
}

async function defaultRead(path: string): Promise<unknown> {
	const { readFile } = await import("node:fs/promises");
	return JSON.parse(await readFile(path, "utf8"));
}

export async function syncCalendarState(
	options: SyncCalendarStateOptions = {},
): Promise<CalendarSyncResult> {
	objectOptions(options);
	const paths =
		options.paths ?? (await resolveCalendarStatePaths(options.currentPath));
	const read = callback(options.readFallback, "readFallback", defaultRead);
	const write = callback(
		options.writeSnapshot,
		"writeSnapshot",
		async (path: string, state: SerializedCalendarState) => {
			await writeCalendarStateAtomically(path, state);
		},
	);
	const emit = callback<(record: string) => void>(
		options.output,
		"output",
		() => {},
	);
	const clock = callback(options.now, "now", () => new Date());
	const overrides: { timeoutMs?: unknown; retries?: unknown } = {};
	if (options.timeoutMs !== undefined) overrides.timeoutMs = options.timeoutMs;
	if (options.retries !== undefined) overrides.retries = options.retries;
	const settings =
		options.settings ??
		resolveCalendarSettings(process.env, {
			...overrides,
		});
	const refreshMetadata =
		options.refreshMetadata === undefined ? false : options.refreshMetadata;
	if (typeof refreshMetadata !== "boolean")
		throw new TypeError("refreshMetadata must be a boolean");

	const fetchLive = callback<
		(fetchOptions?: FantasyCalendarFetchOptions) => Promise<CalendarDate>
	>(
		options.fetchLive,
		"fetchLive",
		(fetchOptions?: FantasyCalendarFetchOptions) =>
			fetchFantasyCalendarDate({
				...fetchOptions,
				timeoutMs: settings.timeoutMs,
				retries: settings.retries,
			}),
	);
	const raw = await read(paths.fallbackPath);
	const current = parseCalendarState(
		bastionCalendar,
		typeof raw === "string" ? JSON.parse(raw) : raw,
	);
	const date = await fetchLive({
		timeoutMs: settings.timeoutMs,
		retries: settings.retries,
	});
	if (date === undefined) throw new TypeError("live date is required");
	const proposed = serializeCalendarState(
		bastionCalendar,
		{
			provider: "fantasy-calendar",
			identifier: BASTION_FANTASY_CALENDAR_HASH,
			endpoint: BASTION_FANTASY_CALENDAR_ENDPOINT,
		},
		date,
		timestamp(clock),
		{ source: "live" },
	);
	const changed =
		canonical(current, false) !== canonical(proposed, false) ||
		(refreshMetadata &&
			(current.retrievedAt !== proposed.retrievedAt ||
				canonical(current, true) !== canonical(proposed, true)));
	if (changed) {
		emit(preview("Current committed state", current));
		emit(preview("Proposed remote state", proposed));
		await write(paths.fallbackPath, proposed);
	}
	return { changed, current, proposed };
}

interface SyncFlags {
	readonly "timeout-ms"?: number;
	readonly retries?: number;
	readonly "refresh-metadata"?: boolean;
}

export default async function syncCommand(
	this: LocalContext,
	flags: SyncFlags,
): Promise<void> {
	const options: SyncCalendarStateOptions = {
		currentPath: this.currentPath,
		refreshMetadata: flags["refresh-metadata"] ?? false,
		output: (record) => this.process.stdout.write(`${record}\n`),
		...(flags["timeout-ms"] === undefined
			? {}
			: { timeoutMs: flags["timeout-ms"] }),
		...(flags.retries === undefined ? {} : { retries: flags.retries }),
	};
	const result = await syncCalendarState(options);
	this.process.stdout.write(
		`calendar snapshot ${result.changed ? "updated" : "unchanged"}\n`,
	);
}
