import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEFAULT_RETRIES,
	DEFAULT_TIMEOUT_MS,
	resolveCalendarSettings,
} from "./settings.js";

test("uses bounded defaults", () => {
	assert.deepEqual(resolveCalendarSettings({}, {}), {
		timeoutMs: DEFAULT_TIMEOUT_MS,
		retries: DEFAULT_RETRIES,
		offline: false,
	});
});

test("accepts valid environment values and CLI overrides win", () => {
	assert.deepEqual(
		resolveCalendarSettings(
			{
				BASTION_CALENDAR_FETCH_TIMEOUT_MS: "5000",
				BASTION_CALENDAR_FETCH_RETRIES: "3",
				BASTION_CALENDAR_OFFLINE: "true",
			},
			{ timeoutMs: 250, offline: false },
		),
		{
			timeoutMs: 250,
			retries: 3,
			offline: false,
		},
	);
});

test("rejects malformed numeric and boolean settings", () => {
	for (const value of ["NaN", "1.5", "-1", "99", "10001"]) {
		assert.throws(
			() =>
				resolveCalendarSettings(
					{ BASTION_CALENDAR_FETCH_TIMEOUT_MS: value },
					{},
				),
			/timeout/i,
		);
	}
	for (const value of ["NaN", "1.5", "-1", "4"]) {
		assert.throws(
			() =>
				resolveCalendarSettings({ BASTION_CALENDAR_FETCH_RETRIES: value }, {}),
			/retries/i,
		);
	}
	for (const value of ["TRUE", "yes", "", "2"]) {
		assert.throws(
			() => resolveCalendarSettings({ BASTION_CALENDAR_OFFLINE: value }, {}),
			/offline/i,
		);
	}
});

test("rejects malformed runtime containers", () => {
	assert.throws(
		() => resolveCalendarSettings(null as never, {}),
		/environment/i,
	);
	assert.throws(() => resolveCalendarSettings({}, null as never), /override/i);
});

test("accepts only finite integer numbers or nonempty decimal strings", () => {
	for (const value of [
		null,
		true,
		false,
		[],
		{},
		"",
		" 1 ",
		NaN,
		Infinity,
		1.5,
		Symbol("one"),
	]) {
		assert.throws(
			() => resolveCalendarSettings({}, { timeoutMs: value }),
			/timeoutMs.*integer/i,
		);
	}
	assert.equal(resolveCalendarSettings({}, { timeoutMs: 100 }).timeoutMs, 100);
	assert.equal(
		resolveCalendarSettings({}, { timeoutMs: "100" }).timeoutMs,
		100,
	);
});
