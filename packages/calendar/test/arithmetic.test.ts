import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	CalendarDuration,
	DatePrecisionError,
	defineCalendar,
} from "../src/index.js";

function createVariableCalendar(
	id = "variable",
	overflow: "constrain" | "reject" = "constrain",
) {
	return defineCalendar({
		id,
		months: [
			{ id: "one", name: "One", days: 2 },
			{ id: "two", name: "Two", days: 3 },
			{ id: "three", name: "Three", days: 4 },
		],
		week: {
			weekdays: ["A", "B", "C", "D"],
			epochWeekday: 0,
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
			epochDay: 0,
			year: 0,
			month: 1,
			day: 1,
		},
		overflow,
	});
}

function date(
	calendar: ReturnType<typeof createVariableCalendar>,
	era: "Future" | "Past",
	year: number,
	month: number,
	day: number,
) {
	return calendar.dateFrom({ era, year, month, day });
}

describe("CalendarDuration", () => {
	it("normalizes missing components and is immutable", () => {
		const duration = new CalendarDuration({ months: -2 });

		assert.deepEqual(duration, new CalendarDuration({ months: -2 }));
		assert.ok(Object.isFrozen(duration));
		assert.throws(() => {
			(duration as { months: number }).months = 3;
		}, TypeError);
	});

	it("rejects fractional and unsafe components", () => {
		for (const value of [0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
			assert.throws(() => new CalendarDuration({ years: value }), RangeError);
			assert.throws(() => new CalendarDuration({ months: value }), RangeError);
			assert.throws(() => new CalendarDuration({ days: value }), RangeError);
		}
	});
});

describe("CalendarDate arithmetic", () => {
	it("adds and subtracts days across variable months, years, and eras", () => {
		const calendar = createVariableCalendar();
		const lastPastDay = date(calendar, "Past", 1, 3, 4);
		const lastFutureDay = date(calendar, "Future", 0, 3, 4);

		assert.deepEqual(lastPastDay.add({ days: 1 }).fields, {
			era: "Future",
			year: 0,
			month: 1,
			day: 1,
		});
		assert.deepEqual(lastFutureDay.add({ days: 1 }).fields, {
			era: "Future",
			year: 1,
			month: 1,
			day: 1,
		});
		assert.deepEqual(
			date(calendar, "Future", 1, 1, 1).subtract({ days: 1 }).fields,
			lastFutureDay.fields,
		);
		assert.deepEqual(
			date(calendar, "Future", 0, 1, 1).subtract({ days: 1 }).fields,
			lastPastDay.fields,
		);
	});

	it("moves months across years and applies years, then months, then days", () => {
		const calendar = createVariableCalendar();
		const source = date(calendar, "Future", 1, 3, 4);

		assert.deepEqual(source.add({ months: 2 }).fields, {
			era: "Future",
			year: 2,
			month: 2,
			day: 3,
		});
		assert.deepEqual(source.subtract({ months: 4 }).fields, {
			era: "Future",
			year: 0,
			month: 2,
			day: 3,
		});
		assert.deepEqual(source.add({ years: 1, months: 1, days: 1 }).fields, {
			era: "Future",
			year: 3,
			month: 2,
			day: 1,
		});
		assert.deepEqual(date(calendar, "Past", 1, 2, 2).add({ years: 1 }).fields, {
			era: "Future",
			year: 0,
			month: 2,
			day: 2,
		});
	});

	it("constrains or rejects invalid destination days without rollover", () => {
		const calendar = createVariableCalendar();
		const source = date(calendar, "Future", 2, 3, 4);

		assert.deepEqual(source.add({ months: 1 }).fields, {
			era: "Future",
			year: 3,
			month: 1,
			day: 2,
		});
		assert.throws(
			() => source.add({ months: 1 }, { overflow: "reject" }),
			RangeError,
		);
		assert.deepEqual(source.with({ month: 1 }).fields, {
			era: "Future",
			year: 2,
			month: 1,
			day: 2,
		});
		assert.throws(
			() => source.with({ month: 1 }, { overflow: "reject" }),
			RangeError,
		);
	});

	it("uses the calendar default unless an explicit overflow option overrides it", () => {
		const rejectCalendar = createVariableCalendar("reject-default", "reject");
		const source = date(rejectCalendar, "Future", 2, 3, 4);

		assert.throws(() => source.add({ months: 1 }), RangeError);
		assert.throws(() => source.with({ month: 1 }), RangeError);
		assert.equal(
			source.add({ months: 1 }, { overflow: "constrain" }).toString(),
			"3-01-02 Future",
		);
		assert.equal(
			source.with({ month: 1 }, { overflow: "constrain" }).toString(),
			"2-01-02 Future",
		);
	});

	it("rejects malformed arithmetic options at the public boundary", () => {
		const calendar = createVariableCalendar();
		const source = date(calendar, "Future", 2, 3, 4);
		const malformedOptions = [null, "constrain", []];
		const operations = [
			(options: unknown) => source.add({ months: 1 }, options as never),
			(options: unknown) => source.subtract({ months: 1 }, options as never),
			(options: unknown) => source.with({ month: 1 }, options as never),
		];

		for (const operation of operations) {
			for (const options of malformedOptions) {
				assert.throws(operation.bind(undefined, options), {
					name: "RangeError",
					message: "options must be an object",
				});
			}
		}
	});

	it("rejects invalid overflow option values", () => {
		const calendar = createVariableCalendar();
		const source = date(calendar, "Future", 2, 3, 4);

		assert.throws(
			() => source.add({ months: 1 }, { overflow: "invalid" } as never),
			{
				name: "RangeError",
				message: 'overflow must be "constrain" or "reject"',
			},
		);
	});

	it("supports negative durations and subtract symmetry", () => {
		const calendar = createVariableCalendar();
		const source = date(calendar, "Future", 3, 2, 2);
		const duration = new CalendarDuration({ years: -1, months: 2, days: -3 });

		assert.deepEqual(
			source.add(duration),
			source.subtract({
				years: 1,
				months: -2,
				days: 3,
			}),
		);
		assert.deepEqual(
			source.subtract(duration),
			source.add({
				years: 1,
				months: -2,
				days: 3,
			}),
		);
	});

	it("leaves source, result, fields, and supplied duration immutable", () => {
		const calendar = createVariableCalendar();
		const source = date(calendar, "Future", 1, 2, 3);
		const duration = Object.freeze({ years: 1, months: 1, days: 1 });
		const result = source.add(duration);

		assert.equal(source.toString(), "1-02-03 Future");
		assert.deepEqual(duration, { years: 1, months: 1, days: 1 });
		assert.ok(Object.isFrozen(source));
		assert.ok(Object.isFrozen(source.fields));
		assert.ok(Object.isFrozen(result));
		assert.ok(Object.isFrozen(result.fields));
	});

	it("returns exact day-only until and since durations with sign symmetry", () => {
		const calendar = createVariableCalendar();
		const first = date(calendar, "Past", 1, 3, 4);
		const second = date(calendar, "Future", 1, 1, 1);

		assert.deepEqual(first.until(second), new CalendarDuration({ days: 10 }));
		assert.deepEqual(second.since(first), first.until(second));
		assert.deepEqual(second.until(first), new CalendarDuration({ days: -10 }));
		assert.deepEqual(first.since(second), second.until(first));
		assert.deepEqual(first.until(first), new CalendarDuration());
		assert.ok(Object.isFrozen(first.until(second)));
	});

	it("rejects invalid until and since operands at the public boundary", () => {
		const calendar = createVariableCalendar();
		const source = date(calendar, "Future", 1, 1, 1);
		const invalidOperands = [null, {}, "1-01-01 Future", []];
		const operations = [
			(other: unknown) => source.until(other as never),
			(other: unknown) => source.since(other as never),
		];

		for (const operation of operations) {
			for (const other of invalidOperands) {
				assert.throws(operation.bind(undefined, other), {
					name: "RangeError",
					message: "other must be a CalendarDate",
				});
			}
		}
	});

	it("rejects arithmetic that requires fields absent from partial dates", () => {
		const calendar = createVariableCalendar();
		const year = calendar.dateFrom({ era: "Future", year: 2 });
		const month = calendar.dateFrom({ era: "Future", year: 2, month: 3 });
		const complete = date(calendar, "Future", 2, 3, 4);

		assert.equal(year.add({ years: 1 }).toString(), "3 Future");
		assert.equal(month.add({ years: 1, months: 1 }).toString(), "4-01 Future");
		assert.throws(() => year.add({ months: 1 }), DatePrecisionError);
		assert.throws(() => year.add({ days: 1 }), DatePrecisionError);
		assert.throws(() => month.add({ days: 1 }), DatePrecisionError);
		assert.throws(() => year.subtract({ months: 1 }), DatePrecisionError);
		assert.throws(() => year.until(complete), DatePrecisionError);
		assert.throws(() => complete.since(month), DatePrecisionError);
	});

	it("lets with update only fields available at the current precision", () => {
		const calendar = createVariableCalendar();
		const year = calendar.dateFrom({ era: "Future", year: 2 });
		const month = calendar.dateFrom({ era: "Future", year: 2, month: 3 });

		assert.equal(year.with({ year: 3 }).toString(), "3 Future");
		assert.equal(month.with({ year: 3, month: 1 }).toString(), "3-01 Future");
		assert.equal(year.with({ year: 3 }).precision, "year");
		assert.equal(month.with({ month: 1 }).precision, "month");
		assert.throws(() => year.with({ month: 1 }), DatePrecisionError);
		assert.throws(() => month.with({ day: 1 }), DatePrecisionError);
	});

	it("rejects until and since across distinct calendar identities", () => {
		const firstCalendar = createVariableCalendar("same-id");
		const secondCalendar = createVariableCalendar("same-id");
		const first = date(firstCalendar, "Future", 1, 1, 1);
		const second = date(secondCalendar, "Future", 1, 1, 1);

		assert.throws(() => first.until(second), RangeError);
		assert.throws(() => first.since(second), RangeError);
	});

	it("rejects duration and final arithmetic overflow", () => {
		const calendar = createVariableCalendar();
		const source = calendar.dateFromEpochDay(1);

		assert.throws(
			() => source.add({ days: Number.MAX_SAFE_INTEGER }),
			RangeError,
		);
		assert.throws(
			() => source.add({ months: Number.MAX_SAFE_INTEGER }),
			RangeError,
		);
		assert.throws(
			() => source.add({ years: Number.MAX_SAFE_INTEGER }),
			RangeError,
		);
	});
});
