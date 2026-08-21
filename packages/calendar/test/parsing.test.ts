import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	BastionDate,
	DatePrecisionError,
	defineCalendar,
} from "../src/index.js";

function createCalendar(
	eraPosition: "prefix" | "suffix",
	dateSeparator: string,
	padMonth: number,
	padDay: number,
) {
	return defineCalendar({
		id: `${eraPosition}-${dateSeparator}`,
		months: [
			{ id: "first", name: "First", days: 9 },
			{ id: "second", name: "Second", days: 12 },
		],
		week: {
			weekdays: ["A", "B"],
			epochWeekday: 0,
		},
		eras: [
			{
				id: "CE+",
				name: "Common Era",
				direction: 1,
				yearOffset: 0,
				minimumYear: 0,
			},
		],
		format: { eraPosition, dateSeparator, padMonth, padDay },
		epoch: {
			epochDay: 0,
			year: 0,
			month: 1,
			day: 1,
		},
		overflow: "constrain",
	});
}

describe("precision-aware date parsing and formatting", () => {
	it("formats Bastion dates canonically at every precision", () => {
		assert.equal(BastionDate.from("1275 AI").toString(), "1275 AI");
		assert.equal(BastionDate.from("1275-09 AI").toString(), "1275-09 AI");
		assert.equal(BastionDate.from("1275-09-25 AI").toString(), "1275-09-25 AI");
	});

	it("normalizes era case and leading zeroes", () => {
		const date = BastionDate.from("001275-009-025 ai");

		assert.equal(date.toString(), "1275-09-25 AI");
		assert.deepEqual(date.fields, { era: "AI", year: 1275, month: 9, day: 25 });
	});

	it("accepts field objects without inventing absent fields", () => {
		const year = BastionDate.from({ era: "ai", year: 1275 });
		const month = BastionDate.from({ era: "AI", year: 1275, month: 9 });
		const day = BastionDate.from({
			era: "AI",
			year: 1275,
			month: 9,
			day: 25,
		});

		assert.equal(year.precision, "year");
		assert.deepEqual(year.fields, { era: "AI", year: 1275 });
		assert.equal("month" in year.fields, false);
		assert.equal("day" in year.fields, false);
		assert.equal(month.precision, "month");
		assert.deepEqual(month.fields, { era: "AI", year: 1275, month: 9 });
		assert.equal("day" in month.fields, false);
		assert.equal(day.precision, "day");
		assert.deepEqual(day.fields, {
			era: "AI",
			year: 1275,
			month: 9,
			day: 25,
		});
	});

	it("honors suffix formatting with a regex-special separator and custom padding", () => {
		const calendar = createCalendar("suffix", ".", 3, 4);

		assert.equal(calendar.dateFrom("0007 CE+").toString(), "7 CE+");
		assert.equal(calendar.dateFrom("0007.02 CE+").toString(), "7.002 CE+");
		assert.equal(
			calendar.dateFrom("0007.02.0009 ce+").toString(),
			"7.002.0009 CE+",
		);
	});

	it("honors exact prefix placement and a regex-special separator", () => {
		const calendar = createCalendar("prefix", "|", 2, 3);

		assert.equal(calendar.dateFrom("ce+ 7").toString(), "CE+ 7");
		assert.equal(calendar.dateFrom("CE+ 7|2").toString(), "CE+ 7|02");
		assert.equal(calendar.dateFrom("CE+ 7|2|9").toString(), "CE+ 7|02|009");
		assert.throws(() => calendar.dateFrom("7|2|9 CE+"));
	});

	it("rejects malformed strings, unknown eras, and invalid present fields", () => {
		const invalid = [
			"1275AI",
			"AI 1275",
			"1275- AI",
			"1275-09- AI",
			"1275-09-25 AI extra",
			"1275-09-25 Unknown",
			"1275-00 AI",
			"1275-13 AI",
			"1275-09-00 AI",
			"1275-09-31 AI",
		];

		for (const input of invalid) {
			assert.throws(() => BastionDate.from(input));
		}
	});

	it("rejects malformed partial field objects", () => {
		const invalid: unknown[] = [
			null,
			{ era: "AI" },
			{ year: 1275 },
			{ era: "Unknown", year: 1275 },
			{ era: "AI", year: 1275, day: 25 },
			{ era: "AI", year: 1275, month: 0 },
			{ era: "AI", year: 1275, month: 9, day: 31 },
		];

		for (const fields of invalid) {
			assert.throws(() => BastionDate.from(fields as never));
		}
	});

	it("exposes epoch days only at day precision", () => {
		assert.throws(
			() => BastionDate.from("1275 AI").epochDay,
			DatePrecisionError,
		);
		assert.throws(
			() => BastionDate.from("1275-09 AI").epochDay,
			DatePrecisionError,
		);
		assert.equal(BastionDate.from("1275-09-25 AI").epochDay, 459264);
	});

	it("with preserves precision and leaves the original immutable", () => {
		const source = BastionDate.from("1275-09 AI");
		const changed = source.with({ year: 1276, month: 10 });

		assert.notEqual(changed, source);
		assert.equal(source.toString(), "1275-09 AI");
		assert.equal(changed.toString(), "1276-10 AI");
		assert.equal(changed.precision, "month");
		assert.ok(Object.isFrozen(source));
		assert.ok(Object.isFrozen(source.fields));
		assert.ok(Object.isFrozen(changed));
		assert.ok(Object.isFrozen(changed.fields));
	});

	it("with rejects implicit precision upgrades", () => {
		const year = BastionDate.from("1275 AI");
		const month = BastionDate.from("1275-09 AI");

		assert.throws(() => year.with({ month: 9 }));
		assert.throws(() => year.with({ day: 25 }));
		assert.throws(() => month.with({ day: 25 }));
	});
});
