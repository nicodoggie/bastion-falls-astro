export const DEFAULT_TIMEOUT_MS = 1_500;
export const DEFAULT_RETRIES = 1;

export interface CalendarSettings {
	readonly timeoutMs: number;
	readonly retries: number;
	readonly offline: boolean;
}

export interface CalendarSettingsOverrides {
	readonly timeoutMs?: unknown;
	readonly retries?: unknown;
	readonly offline?: unknown;
}

function objectRecord(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object`);
	}
	return value as Record<string, unknown>;
}

function integer(
	value: unknown,
	field: string,
	min: number,
	max: number,
): number {
	const numberValue =
		typeof value === "number"
			? value
			: typeof value === "string" && /^[+-]?\d+$/.test(value)
				? Number(value)
				: Number.NaN;
	if (
		!Number.isFinite(numberValue) ||
		!Number.isInteger(numberValue) ||
		numberValue < min ||
		numberValue > max
	) {
		throw new RangeError(`${field} must be an integer from ${min} to ${max}`);
	}
	return numberValue;
}

function boolean(value: unknown, field: string): boolean {
	if (value === true || value === false) return value;
	if (value === "true" || value === "1") return true;
	if (value === "false" || value === "0") return false;
	throw new RangeError(`${field} must be true, false, 1, or 0`);
}

function has(value: object, key: string): boolean {
	return Object.hasOwn(value, key);
}

export function resolveCalendarSettings(
	environment: unknown = process.env,
	overrides: unknown = {},
): CalendarSettings {
	const env = objectRecord(environment, "environment");
	const cli = objectRecord(overrides, "override");
	const timeoutMs = has(cli, "timeoutMs")
		? integer(cli["timeoutMs"], "timeoutMs", 100, 10_000)
		: env["BASTION_CALENDAR_FETCH_TIMEOUT_MS"] === undefined
			? DEFAULT_TIMEOUT_MS
			: integer(
					env["BASTION_CALENDAR_FETCH_TIMEOUT_MS"],
					"timeout",
					100,
					10_000,
				);
	const retries = has(cli, "retries")
		? integer(cli["retries"], "retries", 0, 3)
		: env["BASTION_CALENDAR_FETCH_RETRIES"] === undefined
			? DEFAULT_RETRIES
			: integer(env["BASTION_CALENDAR_FETCH_RETRIES"], "retries", 0, 3);
	const offline = has(cli, "offline")
		? boolean(cli["offline"], "offline")
		: env["BASTION_CALENDAR_OFFLINE"] === undefined
			? false
			: boolean(env["BASTION_CALENDAR_OFFLINE"], "offline");
	return Object.freeze({ timeoutMs, retries, offline });
}
