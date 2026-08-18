import type {
	CalendarEraDefinition,
	CalendarOverflow,
	CalendarSystem,
} from "./definition.js";
import { CalendarDuration, type CalendarDurationLike } from "./duration.js";

export type DatePrecision = "year" | "month" | "day";

export interface YearDateFields {
	readonly era: string;
	readonly year: number;
}

export interface MonthDateFields extends YearDateFields {
	readonly month: number;
}

export interface CompleteDateFields extends MonthDateFields {
	readonly day: number;
}

export type DateFields = YearDateFields | MonthDateFields | CompleteDateFields;

export type DateInput = DateFields | string;

export interface CalendarArithmeticOptions {
	readonly overflow?: CalendarOverflow;
}

export class DatePrecisionError extends RangeError {
	constructor(message: string) {
		super(message);
		this.name = "DatePrecisionError";
	}
}

declare module "./definition.js" {
	interface CalendarSystem {
		dateFrom(input: DateInput): CalendarDate;
	}
}

function fail(message: string): never {
	throw new RangeError(message);
}

function requireSafeInteger(
	value: unknown,
	field: string,
): asserts value is number {
	if (!Number.isSafeInteger(value)) {
		fail(`${field} must be a safe integer`);
	}
}

function hasOwn(value: object, key: string): boolean {
	return Object.hasOwn(value, key);
}

function escapeRegularExpression(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalEra(
	calendar: CalendarSystem,
	eraId: unknown,
): CalendarEraDefinition {
	if (typeof eraId !== "string") {
		fail("era must be a string");
	}
	const normalizedId = eraId.toLocaleLowerCase("en-US");
	const era = calendar.definition.eras.find(
		(candidate) => candidate.id.toLocaleLowerCase("en-US") === normalizedId,
	);
	if (era === undefined) {
		fail(`unknown era ${JSON.stringify(eraId)}`);
	}
	return era;
}

function precisionOf(fields: object): DatePrecision {
	const hasMonth = hasOwn(fields, "month");
	const hasDay = hasOwn(fields, "day");
	if (hasDay && !hasMonth) {
		fail("day requires month");
	}
	if (hasDay) {
		return "day";
	}
	return hasMonth ? "month" : "year";
}

function parseDateString(calendar: CalendarSystem, input: string): DateFields {
	const separator = escapeRegularExpression(
		calendar.definition.format.dateSeparator,
	);
	const eraPattern = calendar.definition.eras
		.map((era) => escapeRegularExpression(era.id))
		.sort((left, right) => right.length - left.length)
		.join("|");
	const datePattern = `(\\d+)(?:${separator}(\\d+)(?:${separator}(\\d+))?)?`;
	const pattern =
		calendar.definition.format.eraPosition === "prefix"
			? new RegExp(`^(${eraPattern}) ${datePattern}$`, "i")
			: new RegExp(`^${datePattern} (${eraPattern})$`, "i");
	const match = pattern.exec(input);
	if (match === null) {
		fail("date string must use the configured canonical format");
	}

	const eraIndex = calendar.definition.format.eraPosition === "prefix" ? 1 : 4;
	const yearIndex = calendar.definition.format.eraPosition === "prefix" ? 2 : 1;
	const monthIndex =
		calendar.definition.format.eraPosition === "prefix" ? 3 : 2;
	const dayIndex = calendar.definition.format.eraPosition === "prefix" ? 4 : 3;
	const era = match[eraIndex];
	const year = match[yearIndex];
	if (era === undefined || year === undefined) {
		fail("date string must contain an era and year");
	}
	const fields: { era: string; year: number; month?: number; day?: number } = {
		era,
		year: Number(year),
	};
	const month = match[monthIndex];
	const day = match[dayIndex];
	if (month !== undefined) {
		fields.month = Number(month);
	}
	if (day !== undefined) {
		fields.day = Number(day);
	}
	return fields as DateFields;
}

const minimumSafeInteger = BigInt(Number.MIN_SAFE_INTEGER);
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function safeNumber(value: bigint, field: string): number {
	if (value < minimumSafeInteger || value > maximumSafeInteger) {
		fail(`${field} must be a safe integer`);
	}
	return Number(value);
}

function floorModulo(dividend: number, divisor: number): number {
	return ((dividend % divisor) + divisor) % divisor;
}

function floorDivideExact(dividend: bigint, divisor: bigint): bigint {
	const quotient = dividend / divisor;
	return dividend < 0n && dividend % divisor !== 0n ? quotient - 1n : quotient;
}

function floorModuloExact(dividend: bigint, divisor: bigint): bigint {
	return ((dividend % divisor) + divisor) % divisor;
}

function resolveOverflow(
	calendar: CalendarSystem,
	options: CalendarArithmeticOptions,
): CalendarOverflow {
	if (
		typeof options !== "object" ||
		options === null ||
		Array.isArray(options)
	) {
		fail("options must be an object");
	}
	const overflow = options.overflow ?? calendar.definition.overflow;
	if (overflow !== "constrain" && overflow !== "reject") {
		fail('overflow must be "constrain" or "reject"');
	}
	return overflow;
}

function internalYearFromEra(
	era: CalendarEraDefinition,
	eraYear: number,
): bigint {
	return BigInt(era.yearOffset) + BigInt(era.direction) * BigInt(eraYear);
}

function ordinalFromInternalFields(
	calendar: CalendarSystem,
	internalYear: bigint,
	month: number,
	day: number,
): bigint {
	const monthOffset = calendar.monthOffsets[month - 1];
	if (monthOffset === undefined) {
		fail("month must identify a configured month");
	}
	const dayOffset = BigInt(monthOffset) + BigInt(day - 1);
	return internalYear * BigInt(calendar.daysPerYear) + dayOffset;
}

function epochAnchorOrdinal(calendar: CalendarSystem): bigint {
	return ordinalFromInternalFields(
		calendar,
		BigInt(calendar.definition.epoch.year),
		calendar.definition.epoch.month,
		calendar.definition.epoch.day,
	);
}

function fieldsToEpochDay(
	calendar: CalendarSystem,
	internalYear: bigint,
	month: number,
	day: number,
): number {
	const ordinal = ordinalFromInternalFields(calendar, internalYear, month, day);
	return safeNumber(
		BigInt(calendar.definition.epoch.epochDay) +
			ordinal -
			epochAnchorOrdinal(calendar),
		"epoch day",
	);
}

function eraFromInternalYear(
	calendar: CalendarSystem,
	internalYear: bigint,
): { era: CalendarEraDefinition; year: number } {
	const matches: { era: CalendarEraDefinition; year: number }[] = [];

	for (const era of calendar.definition.eras) {
		const year =
			(internalYear - BigInt(era.yearOffset)) * BigInt(era.direction);
		if (
			year < BigInt(era.minimumYear) ||
			year < minimumSafeInteger ||
			year > maximumSafeInteger
		) {
			continue;
		}
		matches.push({ era, year: Number(year) });
	}

	if (matches.length === 0) {
		fail(
			`internal year ${internalYear} is not represented by a configured era`,
		);
	}
	if (matches.length > 1) {
		fail(`internal year ${internalYear} has an ambiguous era mapping`);
	}
	const match = matches[0];
	if (match === undefined) {
		fail(
			`internal year ${internalYear} is not represented by a configured era`,
		);
	}
	return match;
}
function validateFields(
	calendar: CalendarSystem,
	input: DateInput,
): {
	precision: DatePrecision;
	fields: DateFields;
	internalYear: bigint;
} {
	const fields =
		typeof input === "string" ? parseDateString(calendar, input) : input;
	if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
		fail("fields must be an object");
	}
	const precision = precisionOf(fields);
	const era = canonicalEra(calendar, fields.era);
	requireSafeInteger(fields.year, "year");
	if (fields.year < era.minimumYear) {
		fail(`year must be at least ${era.minimumYear} in era ${era.id}`);
	}
	const internalYear = internalYearFromEra(era, fields.year);
	if (precision === "year") {
		return {
			precision,
			fields: Object.freeze({ era: era.id, year: fields.year }),
			internalYear,
		};
	}

	const monthValue = (fields as MonthDateFields).month;
	requireSafeInteger(monthValue, "month");
	if (monthValue < 1 || monthValue > calendar.definition.months.length) {
		fail("month must identify a configured month");
	}
	const month = calendar.definition.months[monthValue - 1];
	if (month === undefined) {
		fail("month must identify a configured month");
	}
	if (precision === "month") {
		return {
			precision,
			fields: Object.freeze({
				era: era.id,
				year: fields.year,
				month: monthValue,
			}),
			internalYear,
		};
	}

	const dayValue = (fields as CompleteDateFields).day;
	requireSafeInteger(dayValue, "day");
	if (dayValue < 1 || dayValue > month.days) {
		fail("day must be valid for month");
	}

	return {
		precision,
		fields: Object.freeze({
			era: era.id,
			year: fields.year,
			month: monthValue,
			day: dayValue,
		}),
		internalYear,
	};
}

function fieldsFromEpochDay(
	calendar: CalendarSystem,
	epochDay: number,
): CompleteDateFields {
	requireSafeInteger(epochDay, "epochDay");
	const ordinal =
		epochAnchorOrdinal(calendar) +
		BigInt(epochDay) -
		BigInt(calendar.definition.epoch.epochDay);
	const daysPerYear = BigInt(calendar.daysPerYear);
	const internalYear = floorDivideExact(ordinal, daysPerYear);
	const dayOfYear = Number(floorModuloExact(ordinal, daysPerYear));
	const eraYear = eraFromInternalYear(calendar, internalYear);

	let monthIndex = 0;
	for (const [index, offset] of calendar.monthOffsets.entries()) {
		if (offset > dayOfYear) {
			break;
		}
		monthIndex = index;
	}
	const monthOffset = calendar.monthOffsets[monthIndex];
	if (monthOffset === undefined) {
		fail("date ordinal does not identify a configured month");
	}

	return Object.freeze({
		era: eraYear.era.id,
		year: eraYear.year,
		month: monthIndex + 1,
		day: dayOfYear - monthOffset + 1,
	});
}

export class CalendarDate {
	readonly #calendar: CalendarSystem;
	readonly #epochDay: number | undefined;
	readonly #internalYear: bigint;
	readonly fields: DateFields;
	readonly precision: DatePrecision;

	constructor(calendar: CalendarSystem, input: DateInput) {
		const validated = validateFields(calendar, input);
		this.#calendar = calendar;
		this.#internalYear = validated.internalYear;
		this.fields = validated.fields;
		this.precision = validated.precision;
		this.#epochDay =
			validated.precision === "day"
				? fieldsToEpochDay(
						calendar,
						validated.internalYear,
						(validated.fields as CompleteDateFields).month,
						(validated.fields as CompleteDateFields).day,
					)
				: undefined;
		Object.freeze(this);
	}

	static fromEpochDay(
		calendar: CalendarSystem,
		epochDay: number,
	): CalendarDate {
		return new CalendarDate(calendar, fieldsFromEpochDay(calendar, epochDay));
	}

	get calendarId(): string {
		return this.#calendar.definition.id;
	}

	get epochDay(): number {
		if (this.#epochDay === undefined) {
			throw new DatePrecisionError(
				`epochDay requires day precision, received ${this.precision} precision`,
			);
		}
		return this.#epochDay;
	}

	get weekdayIndex(): number {
		const weekLength = this.#calendar.definition.week.weekdays.length;
		const epochOffset =
			floorModulo(this.epochDay, weekLength) -
			floorModulo(this.#calendar.definition.epoch.epochDay, weekLength);
		return floorModulo(
			this.#calendar.definition.week.epochWeekday + epochOffset,
			weekLength,
		);
	}

	get weekdayName(): string {
		const weekday = this.#calendar.definition.week.weekdays[this.weekdayIndex];
		if (weekday === undefined) {
			fail("weekday index does not identify a configured weekday");
		}
		return weekday;
	}

	toString(): string {
		const format = this.#calendar.definition.format;
		let date = String(this.fields.year);
		if (this.precision !== "year") {
			const fields = this.fields as MonthDateFields;
			date += `${format.dateSeparator}${String(fields.month).padStart(format.padMonth, "0")}`;
		}
		if (this.precision === "day") {
			const fields = this.fields as CompleteDateFields;
			date += `${format.dateSeparator}${String(fields.day).padStart(format.padDay, "0")}`;
		}
		return format.eraPosition === "prefix"
			? `${this.fields.era} ${date}`
			: `${date} ${this.fields.era}`;
	}

	add(
		durationLike: CalendarDurationLike,
		options: CalendarArithmeticOptions = {},
	): CalendarDate {
		const duration = new CalendarDuration(durationLike);
		const overflow = resolveOverflow(this.#calendar, options);
		if (duration.months !== 0 && this.precision === "year") {
			throw new DatePrecisionError(
				"month arithmetic requires at least month precision",
			);
		}
		if (duration.days !== 0 && this.precision !== "day") {
			throw new DatePrecisionError("day arithmetic requires day precision");
		}

		let internalYear = this.#internalYear + BigInt(duration.years);
		let month =
			this.precision === "year"
				? undefined
				: (this.fields as MonthDateFields).month;
		if (duration.months !== 0) {
			const monthsPerYear = BigInt(this.#calendar.definition.months.length);
			const totalMonths =
				internalYear * monthsPerYear +
				BigInt((month as number) - 1) +
				BigInt(duration.months);
			internalYear = floorDivideExact(totalMonths, monthsPerYear);
			month = Number(floorModuloExact(totalMonths, monthsPerYear)) + 1;
		}

		const eraYear = eraFromInternalYear(this.#calendar, internalYear);
		let result: CalendarDate;
		if (this.precision === "year") {
			result = new CalendarDate(this.#calendar, {
				era: eraYear.era.id,
				year: eraYear.year,
			});
		} else if (this.precision === "month") {
			result = new CalendarDate(this.#calendar, {
				era: eraYear.era.id,
				year: eraYear.year,
				month: month as number,
			});
		} else {
			let day = (this.fields as CompleteDateFields).day;
			const destinationMonth =
				this.#calendar.definition.months[(month as number) - 1];
			if (destinationMonth === undefined) {
				fail("month must identify a configured month");
			}
			if (day > destinationMonth.days) {
				if (overflow === "reject") {
					fail("day must be valid for destination month");
				}
				day = destinationMonth.days;
			}
			result = new CalendarDate(this.#calendar, {
				era: eraYear.era.id,
				year: eraYear.year,
				month: month as number,
				day,
			});
		}

		if (duration.days === 0) {
			return result;
		}
		const epochDay = safeNumber(
			BigInt(result.epochDay) + BigInt(duration.days),
			"epoch day",
		);
		return CalendarDate.fromEpochDay(this.#calendar, epochDay);
	}

	subtract(
		durationLike: CalendarDurationLike,
		options: CalendarArithmeticOptions = {},
	): CalendarDate {
		const duration = new CalendarDuration(durationLike);
		return this.add(
			{
				years: -duration.years,
				months: -duration.months,
				days: -duration.days,
			},
			options,
		);
	}

	until(other: CalendarDate): CalendarDuration {
		if (!(other instanceof CalendarDate)) {
			fail("other must be a CalendarDate");
		}
		if (this.#calendar !== other.#calendar) {
			fail("date arithmetic requires the same calendar identity");
		}
		return new CalendarDuration({
			days: safeNumber(BigInt(other.epochDay) - BigInt(this.epochDay), "days"),
		});
	}

	since(other: CalendarDate): CalendarDuration {
		if (!(other instanceof CalendarDate)) {
			fail("other must be a CalendarDate");
		}
		return other.until(this);
	}

	with(
		fields: Partial<CompleteDateFields>,
		options: CalendarArithmeticOptions = {},
	): CalendarDate {
		if (
			typeof fields !== "object" ||
			fields === null ||
			Array.isArray(fields)
		) {
			fail("fields must be an object");
		}
		if (
			(this.precision === "year" &&
				(hasOwn(fields, "month") || hasOwn(fields, "day"))) ||
			(this.precision === "month" && hasOwn(fields, "day"))
		) {
			throw new DatePrecisionError(
				`with cannot add fields below ${this.precision} precision`,
			);
		}
		const overflow = resolveOverflow(this.#calendar, options);
		const merged = { ...this.fields, ...fields };
		if (this.precision !== "day") {
			return new CalendarDate(this.#calendar, merged);
		}

		const complete = merged as CompleteDateFields;
		requireSafeInteger(complete.day, "day");
		const destination = new CalendarDate(this.#calendar, {
			era: complete.era,
			year: complete.year,
			month: complete.month,
			day: 1,
		});
		const destinationMonth =
			this.#calendar.definition.months[
				(destination.fields as CompleteDateFields).month - 1
			];
		if (destinationMonth === undefined) {
			fail("month must identify a configured month");
		}
		if (
			overflow === "reject" &&
			(complete.day < 1 || complete.day > destinationMonth.days)
		) {
			fail("day must be valid for month");
		}
		return new CalendarDate(this.#calendar, {
			...complete,
			day: Math.min(Math.max(complete.day, 1), destinationMonth.days),
		});
	}
}
