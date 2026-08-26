import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FantasyCalendarEventIdSchema,
	FantasyCalendarEventReferenceSchema,
} from "../src/content-schemas.js";

test("normalizes string and safe integer event IDs to canonical strings", () => {
	assert.equal(FantasyCalendarEventIdSchema.parse("  event-7  "), "event-7");
	assert.equal(FantasyCalendarEventIdSchema.parse(42), "42");
});

test("rejects invalid event IDs", () => {
	for (const value of [
		"",
		"   ",
		1.5,
		Number.MAX_SAFE_INTEGER + 1,
		null,
		{},
		[],
	]) {
		assert.throws(() => FantasyCalendarEventIdSchema.parse(value));
	}
});

test("accepts only a strict eventId reference", () => {
	assert.deepEqual(FantasyCalendarEventReferenceSchema.parse({ eventId: 42 }), {
		eventId: "42",
	});
	assert.throws(() =>
		FantasyCalendarEventReferenceSchema.parse({ eventId: "42", extra: true }),
	);
});
