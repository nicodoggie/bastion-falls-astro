import { CalendarDate, type CompleteDateFields } from "./date.js";
import { CalendarDefinitionError } from "./errors.js";

export type CalendarOverflow = "constrain" | "reject";

export interface CalendarMonthDefinition {
	readonly id: string;
	readonly name: string;
	readonly days: number;
}

export interface CalendarEraDefinition {
	readonly id: string;
	readonly name: string;
	readonly direction: 1 | -1;
	readonly yearOffset: number;
	readonly minimumYear: number;
}

export interface CalendarDefinition {
	readonly id: string;
	readonly months: readonly CalendarMonthDefinition[];
	readonly week: {
		readonly weekdays: readonly string[];
		readonly epochWeekday: number;
	};
	readonly eras: readonly CalendarEraDefinition[];
	readonly format: {
		readonly eraPosition: "prefix" | "suffix";
		readonly dateSeparator: string;
		readonly padMonth: number;
		readonly padDay: number;
	};
	readonly epoch: {
		readonly epochDay: number;
		readonly year: number;
		readonly month: number;
		readonly day: number;
	};
	readonly overflow: CalendarOverflow;
}

function fail(message: string): never {
	throw new CalendarDefinitionError(message);
}

function requireRecord<T>(
	value: T,
	field: string,
): asserts value is T & Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(`${field} must be an object`);
	}
}

function requireNonEmptyString(
	value: unknown,
	field: string,
): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		fail(`${field} must be a non-empty string`);
	}
}

function requireSafeInteger(
	value: unknown,
	field: string,
): asserts value is number {
	if (!Number.isSafeInteger(value)) {
		fail(`${field} must be a safe integer`);
	}
}

function requirePositiveInteger(
	value: unknown,
	field: string,
): asserts value is number {
	requireSafeInteger(value, field);
	if (value <= 0) {
		fail(`${field} must be positive`);
	}
}

function validateDefinition(definition: CalendarDefinition): void {
	requireRecord(definition, "definition");
	requireNonEmptyString(definition.id, "id");

	if (!Array.isArray(definition.months) || definition.months.length === 0) {
		fail("months must contain at least one month");
	}

	const monthIds = new Set<string>();
	for (const [index, month] of definition.months.entries()) {
		requireRecord(month, `months[${index}]`);
		requireNonEmptyString(month.id, `months[${index}].id`);
		requireNonEmptyString(month.name, `months[${index}].name`);
		requirePositiveInteger(month.days, `months[${index}].days`);
		if (monthIds.has(month.id)) {
			fail(`months contains duplicate id ${JSON.stringify(month.id)}`);
		}
		monthIds.add(month.id);
	}

	requireRecord(definition.week, "week");
	if (
		!Array.isArray(definition.week.weekdays) ||
		definition.week.weekdays.length === 0
	) {
		fail("week.weekdays must contain at least one weekday");
	}
	for (const [index, weekday] of definition.week.weekdays.entries()) {
		requireNonEmptyString(weekday, `week.weekdays[${index}]`);
	}
	requireSafeInteger(definition.week.epochWeekday, "week.epochWeekday");
	if (
		definition.week.epochWeekday < 0 ||
		definition.week.epochWeekday >= definition.week.weekdays.length
	) {
		fail("week.epochWeekday must identify a configured weekday");
	}

	if (!Array.isArray(definition.eras) || definition.eras.length === 0) {
		fail("eras must contain at least one era");
	}

	const eraIds = new Set<string>();
	for (const [index, era] of definition.eras.entries()) {
		requireRecord(era, `eras[${index}]`);
		requireNonEmptyString(era.id, `eras[${index}].id`);
		requireNonEmptyString(era.name, `eras[${index}].name`);
		if (era.direction !== 1 && era.direction !== -1) {
			fail(`eras[${index}].direction must be 1 or -1`);
		}
		requireSafeInteger(era.yearOffset, `eras[${index}].yearOffset`);
		requireSafeInteger(era.minimumYear, `eras[${index}].minimumYear`);
		if (era.minimumYear < 0) {
			fail(`eras[${index}].minimumYear must not be negative`);
		}
		const normalizedEraId = era.id.toLocaleLowerCase("en-US");
		if (eraIds.has(normalizedEraId)) {
			fail(`eras contains duplicate id ${JSON.stringify(era.id)}`);
		}
		eraIds.add(normalizedEraId);
	}

	requireRecord(definition.format, "format");
	if (
		definition.format.eraPosition !== "prefix" &&
		definition.format.eraPosition !== "suffix"
	) {
		fail('format.eraPosition must be "prefix" or "suffix"');
	}
	requireNonEmptyString(
		definition.format.dateSeparator,
		"format.dateSeparator",
	);
	if (/[0-9]/.test(definition.format.dateSeparator)) {
		fail("format.dateSeparator must not contain ASCII decimal digits");
	}
	requirePositiveInteger(definition.format.padMonth, "format.padMonth");
	requirePositiveInteger(definition.format.padDay, "format.padDay");

	requireRecord(definition.epoch, "epoch");
	requireSafeInteger(definition.epoch.epochDay, "epoch.epochDay");
	requireSafeInteger(definition.epoch.year, "epoch.year");
	requireSafeInteger(definition.epoch.month, "epoch.month");
	if (
		definition.epoch.month < 1 ||
		definition.epoch.month > definition.months.length
	) {
		fail("epoch.month must identify a configured month");
	}
	requireSafeInteger(definition.epoch.day, "epoch.day");
	const epochMonth = definition.months[definition.epoch.month - 1];
	if (epochMonth === undefined) {
		fail("epoch.month must identify a configured month");
	}
	if (definition.epoch.day < 1 || definition.epoch.day > epochMonth.days) {
		fail("epoch.day must be valid for epoch.month");
	}

	if (definition.overflow !== "constrain" && definition.overflow !== "reject") {
		fail('overflow must be "constrain" or "reject"');
	}
}

function copyAndFreezeDefinition(
	definition: CalendarDefinition,
): CalendarDefinition {
	const months = Object.freeze(
		definition.months.map((month) => Object.freeze({ ...month })),
	);
	const weekdays = Object.freeze([...definition.week.weekdays]);
	const eras = Object.freeze(
		definition.eras.map((era) => Object.freeze({ ...era })),
	);

	return Object.freeze({
		id: definition.id,
		months,
		week: Object.freeze({
			weekdays,
			epochWeekday: definition.week.epochWeekday,
		}),
		eras,
		format: Object.freeze({ ...definition.format }),
		epoch: Object.freeze({ ...definition.epoch }),
		overflow: definition.overflow,
	});
}

class RuntimeReadonlyMap<K, V> implements ReadonlyMap<K, V> {
	readonly #map: Map<K, V>;

	constructor(entries: Iterable<readonly [K, V]>) {
		this.#map = new Map(entries);
		Object.freeze(this);
	}

	get size(): number {
		return this.#map.size;
	}

	get(key: K): V | undefined {
		return this.#map.get(key);
	}

	has(key: K): boolean {
		return this.#map.has(key);
	}

	forEach(
		callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
		thisArg?: unknown,
	): void {
		for (const [key, value] of this.#map) {
			callback.call(thisArg, value, key, this);
		}
	}

	entries() {
		return this.#map.entries();
	}

	keys() {
		return this.#map.keys();
	}

	values() {
		return this.#map.values();
	}

	[Symbol.iterator]() {
		return this.#map[Symbol.iterator]();
	}

	get [Symbol.toStringTag](): string {
		return "Map";
	}
}

export class CalendarSystem {
	readonly definition: CalendarDefinition;
	readonly monthOffsets: readonly number[];
	readonly daysPerYear: number;
	readonly monthsById: ReadonlyMap<string, CalendarMonthDefinition>;
	readonly erasById: ReadonlyMap<string, CalendarEraDefinition>;

	constructor(definition: CalendarDefinition) {
		validateDefinition(definition);
		this.definition = copyAndFreezeDefinition(definition);

		const monthOffsets: number[] = [];
		let daysPerYear = 0;
		for (const month of this.definition.months) {
			monthOffsets.push(daysPerYear);
			daysPerYear += month.days;
			if (!Number.isSafeInteger(daysPerYear)) {
				fail("total days per year must be a safe integer");
			}
		}

		this.monthOffsets = Object.freeze(monthOffsets);
		this.daysPerYear = daysPerYear;
		this.monthsById = new RuntimeReadonlyMap(
			this.definition.months.map((month) => [month.id, month]),
		);
		this.erasById = new RuntimeReadonlyMap(
			this.definition.eras.map((era) => [era.id, era]),
		);
		Object.freeze(this);
	}

	dateFrom(fields: CompleteDateFields): CalendarDate {
		return new CalendarDate(this, fields);
	}

	dateFromEpochDay(epochDay: number): CalendarDate {
		return CalendarDate.fromEpochDay(this, epochDay);
	}
}

export function defineCalendar(definition: CalendarDefinition): CalendarSystem {
	return new CalendarSystem(definition);
}
