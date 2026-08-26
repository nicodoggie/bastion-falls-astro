import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	type CalendarDefinition,
	CalendarDefinitionError,
	defineCalendar,
} from "../src/index.js";

function createDefinition() {
	return {
		id: "test-calendar",
		months: [
			{ id: "first", name: "First", days: 30 },
			{ id: "second", name: "Second", days: 31 },
		],
		week: {
			weekdays: ["One", "Two", "Three"],
			epochWeekday: 1,
		},
		eras: [
			{
				id: "CE",
				name: "Common Era",
				direction: 1 as const,
				yearOffset: 0,
				minimumYear: 0,
			},
		],
		format: {
			eraPosition: "suffix" as const,
			dateSeparator: "-",
			padMonth: 2,
			padDay: 2,
		},
		epoch: {
			epochDay: 0,
			year: 0,
			month: 1,
			day: 1,
		},
		overflow: "constrain" as const,
	};
}

function assertDefinitionError(action: () => unknown): void {
	assert.throws(action, CalendarDefinitionError);
}

function monthAt(
	definition: ReturnType<typeof createDefinition>,
	index: number,
) {
	const month = definition.months[index];
	assert.ok(month);
	return month;
}

function eraAt(definition: ReturnType<typeof createDefinition>, index: number) {
	const era = definition.eras[index];
	assert.ok(era);
	return era;
}

describe("defineCalendar", () => {
	it("constructs a valid repeating calendar and precomputes its fixed values", () => {
		const system = defineCalendar(createDefinition());

		assert.equal(system.definition.id, "test-calendar");
		assert.equal(system.daysPerYear, 61);
		assert.deepEqual(system.monthOffsets, [0, 30]);
		assert.equal(system.monthsById.get("second")?.name, "Second");
		assert.equal(system.erasById.get("CE")?.name, "Common Era");
	});

	it("prevents runtime mutation of lookup maps", () => {
		const system = defineCalendar(createDefinition());
		const monthsById = system.monthsById as Map<
			string,
			(typeof system.definition.months)[number]
		>;
		const erasById = system.erasById as Map<
			string,
			(typeof system.definition.eras)[number]
		>;

		assert.throws(
			() => monthsById.set("third", { id: "third", name: "Third", days: 1 }),
			TypeError,
		);
		assert.throws(() => monthsById.delete("first"), TypeError);
		assert.throws(() => erasById.clear(), TypeError);
		assert.equal(system.monthsById.has("third"), false);
		assert.equal(system.monthsById.get("first")?.name, "First");
		assert.equal(system.erasById.get("CE")?.name, "Common Era");
	});

	it("rejects duplicate month IDs", () => {
		const definition = createDefinition();
		monthAt(definition, 1).id = "first";

		assertDefinitionError(() => defineCalendar(definition));
	});

	it("rejects an empty month list", () => {
		const definition = createDefinition();
		definition.months = [];

		assertDefinitionError(() => defineCalendar(definition));
	});

	it("rejects an empty weekday list", () => {
		const definition = createDefinition();
		definition.week.weekdays = [];

		assertDefinitionError(() => defineCalendar(definition));
	});

	it("rejects an empty era list", () => {
		const definition = createDefinition();
		definition.eras = [];

		assertDefinitionError(() => defineCalendar(definition));
	});

	it("rejects malformed definition containers with CalendarDefinitionError", () => {
		const invalidDefinitions: unknown[] = [
			null,
			{ ...createDefinition(), week: null },
			{ ...createDefinition(), week: undefined },
			{ ...createDefinition(), format: null },
			{ ...createDefinition(), format: undefined },
			{ ...createDefinition(), epoch: null },
			{ ...createDefinition(), epoch: undefined },
			{ ...createDefinition(), months: [null] },
			{ ...createDefinition(), eras: [null] },
		];

		for (const definition of invalidDefinitions) {
			assertDefinitionError(() =>
				defineCalendar(definition as CalendarDefinition),
			);
		}
	});

	it("rejects nonpositive month lengths", () => {
		for (const days of [0, -1]) {
			const definition = createDefinition();
			monthAt(definition, 0).days = days;

			assertDefinitionError(() => defineCalendar(definition));
		}
	});

	it("rejects an out-of-range epoch weekday", () => {
		for (const epochWeekday of [-1, 3]) {
			const definition = createDefinition();
			definition.week.epochWeekday = epochWeekday;

			assertDefinitionError(() => defineCalendar(definition));
		}
	});

	it("rejects invalid format settings", () => {
		const invalidDefinitions: CalendarDefinition[] = [
			{
				...createDefinition(),
				format: {
					...createDefinition().format,
					eraPosition: "middle" as "prefix",
				},
			},
			{
				...createDefinition(),
				format: { ...createDefinition().format, dateSeparator: "" },
			},
			{
				...createDefinition(),
				format: { ...createDefinition().format, padMonth: 0 },
			},
			{
				...createDefinition(),
				format: { ...createDefinition().format, padDay: 1.5 },
			},
		];

		for (const definition of invalidDefinitions) {
			assertDefinitionError(() => defineCalendar(definition));
		}
	});

	it("rejects date separators containing ASCII decimal digits", () => {
		for (const dateSeparator of ["1", ".2"]) {
			const definition = createDefinition();
			definition.format.dateSeparator = dateSeparator;

			assertDefinitionError(() => defineCalendar(definition));
		}
	});

	it("rejects invalid epoch fields", () => {
		const invalidDefinitions: CalendarDefinition[] = [
			{
				...createDefinition(),
				epoch: { ...createDefinition().epoch, epochDay: 0.5 },
			},
			{
				...createDefinition(),
				epoch: { ...createDefinition().epoch, year: 0.5 },
			},
			{
				...createDefinition(),
				epoch: { ...createDefinition().epoch, month: 0 },
			},
			{
				...createDefinition(),
				epoch: { ...createDefinition().epoch, month: 3 },
			},
			{ ...createDefinition(), epoch: { ...createDefinition().epoch, day: 0 } },
			{
				...createDefinition(),
				epoch: { ...createDefinition().epoch, day: 31 },
			},
		];

		for (const definition of invalidDefinitions) {
			assertDefinitionError(() => defineCalendar(definition));
		}
	});

	it("rejects duplicate era IDs", () => {
		const definition = createDefinition();
		definition.eras.push({
			id: "CE",
			name: "Other Era",
			direction: 1,
			yearOffset: -1,
			minimumYear: 1,
		});

		assertDefinitionError(() => defineCalendar(definition));
	});

	it("rejects case-only duplicate era IDs", () => {
		const definition = createDefinition();
		definition.eras.push({
			id: "ce",
			name: "Other Era",
			direction: 1,
			yearOffset: -1,
			minimumYear: 1,
		});

		assert.throws(() => defineCalendar(definition), CalendarDefinitionError);
	});

	it("rejects invalid minimum years", () => {
		for (const minimumYear of [-1, 0.5]) {
			const definition = createDefinition();
			eraAt(definition, 0).minimumYear = minimumYear;

			assertDefinitionError(() => defineCalendar(definition));
		}
	});

	it("defensively copies and deeply freezes the definition", () => {
		const source = createDefinition();
		const system = defineCalendar(source);

		source.id = "changed";
		monthAt(source, 0).name = "Changed";
		source.week.weekdays[0] = "Changed";
		eraAt(source, 0).name = "Changed";
		source.format.dateSeparator = "/";
		source.epoch.day = 2;

		assert.equal(system.definition.id, "test-calendar");
		assert.equal(system.definition.months[0]?.name, "First");
		assert.equal(system.definition.week.weekdays[0], "One");
		assert.equal(system.definition.eras[0]?.name, "Common Era");
		assert.equal(system.definition.format.dateSeparator, "-");
		assert.equal(system.definition.epoch.day, 1);

		assert.ok(Object.isFrozen(system.definition));
		assert.ok(Object.isFrozen(system.definition.months));
		assert.ok(Object.isFrozen(system.definition.months[0]));
		assert.ok(Object.isFrozen(system.definition.week));
		assert.ok(Object.isFrozen(system.definition.week.weekdays));
		assert.ok(Object.isFrozen(system.definition.eras));
		assert.ok(Object.isFrozen(system.definition.eras[0]));
		assert.ok(Object.isFrozen(system.definition.format));
		assert.ok(Object.isFrozen(system.definition.epoch));

		assert.throws(() => {
			const firstMonth = (
				system.definition.months as unknown as { name: string }[]
			)[0];
			assert.ok(firstMonth);
			firstMonth.name = "Changed";
		}, TypeError);
	});
});
