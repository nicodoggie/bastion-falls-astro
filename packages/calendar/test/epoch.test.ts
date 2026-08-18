import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	BastionDate,
	type CalendarDefinition,
	defineCalendar,
} from "../src/index.js";

function createVariableCalendar(id = "variable") {
	return defineCalendar({
		id,
		months: [
			{ id: "one", name: "One", days: 2 },
			{ id: "two", name: "Two", days: 3 },
			{ id: "three", name: "Three", days: 4 },
		],
		week: {
			weekdays: ["A", "B", "C", "D"],
			epochWeekday: 2,
		},
		eras: [
			{
				id: "Future",
				name: "Future",
				direction: 1,
				yearOffset: 0,
				minimumYear: 0,
			},
			{
				id: "Past",
				name: "Past",
				direction: -1,
				yearOffset: 0,
				minimumYear: 1,
			},
		],
		format: {
			eraPosition: "suffix",
			dateSeparator: "-",
			padMonth: 2,
			padDay: 2,
		},
		epoch: {
			epochDay: 10,
			year: 0,
			month: 2,
			day: 2,
		},
		overflow: "constrain",
	});
}

function createTwoDayCalendar(eras: CalendarDefinition["eras"]) {
	return defineCalendar({
		id: "two-day",
		months: [{ id: "only", name: "Only", days: 2 }],
		week: {
			weekdays: ["A"],
			epochWeekday: 0,
		},
		eras,
		format: {
			eraPosition: "suffix",
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
		overflow: "constrain",
	});
}

function assertRoundTrip(
	calendar: ReturnType<typeof createVariableCalendar>,
	fields: { era: string; year: number; month: number; day: number },
): void {
	const date = calendar.dateFrom(fields);
	assert.deepEqual(calendar.dateFromEpochDay(date.epochDay).fields, fields);
}

describe("complete date epoch conversion", () => {
	it("round-trips the configured epoch anchor", () => {
		const calendar = createVariableCalendar();
		const date = calendar.dateFrom({
			era: "Future",
			year: 0,
			month: 2,
			day: 2,
		});

		assert.equal(date.epochDay, 10);
		assert.deepEqual(calendar.dateFromEpochDay(10).fields, date.fields);
	});

	it("round-trips safe fields whose private internal year exceeds the safe range", () => {
		const calendar = defineCalendar({
			id: "large-internal-year",
			months: [{ id: "only", name: "Only", days: 1 }],
			week: {
				weekdays: ["A"],
				epochWeekday: 0,
			},
			eras: [
				{
					id: "Future",
					name: "Future",
					direction: 1,
					yearOffset: Number.MAX_SAFE_INTEGER,
					minimumYear: 0,
				},
			],
			format: {
				eraPosition: "suffix",
				dateSeparator: "-",
				padMonth: 2,
				padDay: 2,
			},
			epoch: {
				epochDay: 0,
				year: Number.MAX_SAFE_INTEGER,
				month: 1,
				day: 1,
			},
			overflow: "constrain",
		});
		const fields = {
			era: "Future",
			year: Number.MAX_SAFE_INTEGER,
			month: 1,
			day: 1,
		};

		assert.equal(calendar.dateFrom(fields).epochDay, Number.MAX_SAFE_INTEGER);
		assert.deepEqual(
			calendar.dateFromEpochDay(Number.MAX_SAFE_INTEGER).fields,
			fields,
		);
	});

	it("round-trips the first and last day of every variable-length month", () => {
		const calendar = createVariableCalendar();
		const monthLengths = [2, 3, 4];

		for (const [index, days] of monthLengths.entries()) {
			const month = index + 1;
			assertRoundTrip(calendar, {
				era: "Future",
				year: 2,
				month,
				day: 1,
			});
			assertRoundTrip(calendar, {
				era: "Future",
				year: 2,
				month,
				day: days,
			});
		}
	});

	it("crosses previous and next year boundaries", () => {
		const calendar = createVariableCalendar();
		const first = calendar.dateFrom({
			era: "Future",
			year: 0,
			month: 1,
			day: 1,
		});
		const previous = calendar.dateFromEpochDay(first.epochDay - 1);
		const next = calendar.dateFromEpochDay(
			first.epochDay + calendar.daysPerYear,
		);

		assert.deepEqual(previous.fields, {
			era: "Past",
			year: 1,
			month: 3,
			day: 4,
		});
		assert.deepEqual(next.fields, {
			era: "Future",
			year: 1,
			month: 1,
			day: 1,
		});
	});

	it("round-trips negative internal years using floor division", () => {
		const calendar = createVariableCalendar();

		for (const year of [1, 2, 17]) {
			assertRoundTrip(calendar, { era: "Past", year, month: 1, day: 1 });
			assertRoundTrip(calendar, { era: "Past", year, month: 3, day: 4 });
		}
	});

	it("round-trips minimum safe epoch days across the year boundary", () => {
		const calendar = createTwoDayCalendar([
			{
				id: "Future",
				name: "Future",
				direction: 1,
				yearOffset: 0,
				minimumYear: 0,
			},
			{
				id: "Past",
				name: "Past",
				direction: -1,
				yearOffset: 0,
				minimumYear: 1,
			},
		]);

		for (const epochDay of [
			Number.MIN_SAFE_INTEGER,
			Number.MIN_SAFE_INTEGER + 1,
		]) {
			assert.equal(calendar.dateFromEpochDay(epochDay).epochDay, epochDay);
		}
	});

	it("ignores out-of-range inverse era candidates regardless of ordering", () => {
		const actualEra = {
			id: "Past",
			name: "Past",
			direction: -1 as const,
			yearOffset: 0,
			minimumYear: 1,
		};
		const unrelatedEra = {
			id: "Unrelated",
			name: "Unrelated",
			direction: 1 as const,
			yearOffset: Number.MAX_SAFE_INTEGER,
			minimumYear: 0,
		};

		for (const eras of [
			[unrelatedEra, actualEra],
			[actualEra, unrelatedEra],
		]) {
			const calendar = createTwoDayCalendar(eras);

			assert.deepEqual(calendar.dateFromEpochDay(-2).fields, {
				era: "Past",
				year: 1,
				month: 1,
				day: 1,
			});
		}
	});

	it("rejects invalid complete fields and unsafe epoch days", () => {
		const calendar = createVariableCalendar();
		const invalidFields: unknown[] = [
			{ era: "Unknown", year: 0, month: 1, day: 1 },
			{ era: "Past", year: 0, month: 1, day: 1 },
			{ era: "Future", year: -1, month: 1, day: 1 },
			{ era: "Future", year: 0.5, month: 1, day: 1 },
			{ era: "Future", year: 0, month: 0, day: 1 },
			{ era: "Future", year: 0, month: 4, day: 1 },
			{ era: "Future", year: 0, month: 1, day: 0 },
			{ era: "Future", year: 0, month: 1, day: 3 },
			null,
		];

		for (const fields of invalidFields) {
			assert.throws(() =>
				calendar.dateFrom(
					fields as { era: string; year: number; month: number; day: number },
				),
			);
		}
		for (const epochDay of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
			assert.throws(() => calendar.dateFromEpochDay(epochDay));
		}
		assert.throws(() =>
			calendar.dateFrom({
				era: "Future",
				year: Number.MAX_SAFE_INTEGER,
				month: 1,
				day: 1,
			}),
		);
	});

	it("calculates weekdays from the configured epoch weekday", () => {
		const calendar = createVariableCalendar();

		assert.equal(calendar.dateFromEpochDay(10).weekdayIndex, 2);
		assert.equal(calendar.dateFromEpochDay(10).weekdayName, "C");
		assert.equal(calendar.dateFromEpochDay(11).weekdayName, "D");
		assert.equal(calendar.dateFromEpochDay(8).weekdayName, "A");
	});

	it("binds immutable values and fields to their originating calendar", () => {
		const firstCalendar = createVariableCalendar("first-calendar");
		const secondCalendar = createVariableCalendar("second-calendar");
		const source = { era: "Future", year: 0, month: 1, day: 1 };
		const firstDate = firstCalendar.dateFrom(source);
		const secondDate = secondCalendar.dateFrom(source);

		source.day = 2;
		assert.equal(firstDate.calendarId, "first-calendar");
		assert.equal(secondDate.calendarId, "second-calendar");
		assert.deepEqual(firstDate.fields, {
			era: "Future",
			year: 0,
			month: 1,
			day: 1,
		});
		assert.ok(Object.isFrozen(firstDate));
		assert.ok(Object.isFrozen(firstDate.fields));
		assert.throws(() => {
			(firstDate.fields as { day: number }).day = 2;
		}, TypeError);
	});

	it("rejects ambiguous inverse era mappings", () => {
		const definition: CalendarDefinition = {
			...createVariableCalendar().definition,
			eras: [
				{
					id: "First",
					name: "First",
					direction: 1,
					yearOffset: 0,
					minimumYear: 0,
				},
				{
					id: "Second",
					name: "Second",
					direction: 1,
					yearOffset: 0,
					minimumYear: 0,
				},
			],
		};
		const calendar = defineCalendar(definition);
		const epochDay = calendar.dateFrom({
			era: "First",
			year: 0,
			month: 1,
			day: 1,
		}).epochDay;

		assert.throws(() => calendar.dateFromEpochDay(epochDay));
	});
});

describe("Bastion calendar epoch anchors", () => {
	it("matches the verified Fantasy Calendar epoch and weekday", () => {
		assert.equal(
			BastionDate.from({ era: "AI", year: 0, month: 1, day: 1 }).epochDay,
			0,
		);
		assert.equal(
			BastionDate.from({
				era: "AI",
				year: 1275,
				month: 9,
				day: 25,
			}).epochDay,
			459264,
		);
		assert.deepEqual(BastionDate.fromEpochDay(459264).fields, {
			era: "AI",
			year: 1275,
			month: 9,
			day: 25,
		});
		assert.equal(BastionDate.fromEpochDay(459264).weekdayName, "Sunday");
	});
});
