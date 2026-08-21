export interface CalendarDurationLike {
	readonly years?: number;
	readonly months?: number;
	readonly days?: number;
}

function normalizeComponent(value: number | undefined, field: string): number {
	const normalized = value ?? 0;
	if (!Number.isSafeInteger(normalized)) {
		throw new RangeError(`${field} must be a safe integer`);
	}
	return normalized;
}

export class CalendarDuration {
	readonly years: number;
	readonly months: number;
	readonly days: number;

	constructor(duration: CalendarDurationLike = {}) {
		if (
			typeof duration !== "object" ||
			duration === null ||
			Array.isArray(duration)
		) {
			throw new RangeError("duration must be an object");
		}
		this.years = normalizeComponent(duration.years, "years");
		this.months = normalizeComponent(duration.months, "months");
		this.days = normalizeComponent(duration.days, "days");
		Object.freeze(this);
	}
}
