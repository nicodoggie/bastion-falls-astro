import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	BastionDate,
	CalendarDate,
	DatePrecisionError,
	defineCalendar,
} from "../src/index.js";

function createCalendar(id: string, monthDays = [10, 10]) {
	return defineCalendar({
		id,
		months: monthDays.map((days, index) => ({
			id: `month-${index + 1}`,
			name: `Month ${index + 1}`,
			days,
		})),
		week: { weekdays: ["day"], epochWeekday: 0 },
		eras: [
			{ id: "AI", name: "AI", direction: 1, yearOffset: 0, minimumYear: 0 },
			{ id: "PF", name: "PF", direction: -1, yearOffset: 0, minimumYear: 1 },
		],
		format: { eraPosition: "suffix", dateSeparator: "-", padMonth: 2, padDay: 2 },
		epoch: { epochDay: 0, year: 0, month: 1, day: 1 },
		overflow: "constrain",
	});
}

describe("CalendarDate comparison and completed-year age", () => {
	it("compares and tests equality within one calendar identity", () => {
		const calendar = createCalendar("one");
		const first = calendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 });
		const same = calendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 });
		const later = calendar.dateFrom({ era: "AI", year: 1, month: 1, day: 2 });

		assert.equal(CalendarDate.compare(first, same), 0);
		assert.equal(CalendarDate.compare(first, later), -1);
		assert.equal(CalendarDate.compare(later, first), 1);
		assert.equal(first.equals(same), true);
		assert.equal(first.equals(later), false);
	});

	it("compares complete dates from distinct calendars through epoch days", () => {
		const firstCalendar = createCalendar("first");
		const secondCalendar = createCalendar("second", [5, 15]);
		const first = firstCalendar.dateFromEpochDay(11);
		const second = secondCalendar.dateFromEpochDay(11);
		const later = secondCalendar.dateFromEpochDay(12);

		assert.equal(CalendarDate.compare(first, second), 0);
		assert.equal(first.equals(second), true);
		assert.equal(CalendarDate.compare(first, later), -1);
	});

	it("rejects partial dates for cross-calendar comparison", () => {
		const firstCalendar = createCalendar("first");
		const secondCalendar = createCalendar("second");
		const year = firstCalendar.dateFrom({ era: "AI", year: 1 });
		const day = secondCalendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 });

		assert.throws(() => CalendarDate.compare(year, day), DatePrecisionError);
		assert.throws(() => year.equals(day), DatePrecisionError);
	});

	it("rejects ambiguous mixed-precision comparison within one calendar", () => {
		const calendar = createCalendar("one");
		const year = calendar.dateFrom({ era: "AI", year: 1 });
		const month = calendar.dateFrom({ era: "AI", year: 1, month: 1 });
		const day = calendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 });

		for (const [left, right] of [
			[year, month],
			[month, day],
		]) {
			assert.throws(() => CalendarDate.compare(left, right), DatePrecisionError);
			assert.throws(() => left.equals(right), DatePrecisionError);
		}
	});

	it("counts birthdays one day before, on, and one day after", () => {
		const birth = BastionDate.from("100-03-15 AI");
		assert.equal(birth.ageOn(BastionDate.from("110-03-14 AI")), 9);
		assert.equal(birth.ageOn(BastionDate.from("110-03-15 AI")), 10);
		assert.equal(birth.ageOn(BastionDate.from("110-03-16 AI")), 10);
	});

	it("counts completed years across PF and AI", () => {
		const birth = BastionDate.from("1-03-15 PF");
		assert.equal(birth.ageOn(BastionDate.from("1-03-14 AI")), 1);
		assert.equal(birth.ageOn(BastionDate.from("1-03-15 AI")), 2);
	});

	it("rejects references before birth and partial age operands", () => {
		const birth = BastionDate.from("100-03-15 AI");
		assert.throws(() => birth.ageOn(BastionDate.from("99-03-15 AI")), RangeError);
		assert.throws(() => birth.ageOn(BastionDate.from("110-03 AI")), DatePrecisionError);
		assert.throws(() => BastionDate.from("100-03 AI").ageOn(birth), DatePrecisionError);
	});

	it("rejects age calculation across distinct calendar identities", () => {
		const birthCalendar = createCalendar("birth");
		const referenceCalendar = createCalendar("reference");
		const birth = birthCalendar.dateFrom({ era: "AI", year: 1, month: 1, day: 1 });
		const reference = referenceCalendar.dateFrom({
			era: "AI",
			year: 2,
			month: 1,
			day: 1,
		});

		assert.throws(() => birth.ageOn(reference), {
			name: "RangeError",
			message: "age calculation requires the same calendar identity",
		});
	});

	it("rejects invalid public operands with deliberate RangeErrors", () => {
		const date = BastionDate.from("100-03-15 AI");
		for (const other of [null, [], "100-03-15 AI", {}]) {
			assert.throws(() => CalendarDate.compare(date, other as never), RangeError);
			assert.throws(() => date.equals(other as never), RangeError);
			assert.throws(() => date.ageOn(other as never), RangeError);
		}
	});
});
