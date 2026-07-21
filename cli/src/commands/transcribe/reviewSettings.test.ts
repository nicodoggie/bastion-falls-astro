import assert from "node:assert/strict";
import { test } from "node:test";

import {
	parseReviewProvider,
	resolveReviewSettings,
} from "./reviewSettings.js";

test("parses supported review providers", () => {
	assert.equal(parseReviewProvider("hermes"), "hermes");
	assert.equal(parseReviewProvider("off"), "off");
	assert.throws(
		() => parseReviewProvider("codex"),
		/Unsupported review provider: codex/,
	);
});

test("uses command-line review provider before project configuration", () => {
	assert.deepEqual(
		resolveReviewSettings(
			{ provider: "hermes", hermes: { profile: "reviewer" } },
			{ provider: "off" },
		),
		{ provider: "off", hermesProfile: "reviewer", hermesMaxTurns: 12 },
	);
});

test("uses project review provider before the disabled default", () => {
	assert.deepEqual(resolveReviewSettings({ provider: "hermes" }), {
		provider: "hermes",
		hermesProfile: undefined,
		hermesMaxTurns: 12,
	});
	assert.deepEqual(resolveReviewSettings(undefined), {
		provider: "off",
		hermesProfile: undefined,
		hermesMaxTurns: 12,
	});
});

test("uses command-line Hermes profile before project configuration", () => {
	assert.deepEqual(
		resolveReviewSettings(
			{ provider: "hermes", hermes: { profile: "configured" } },
			{ hermesProfile: "override", hermesMaxTurns: 7 },
		),
		{ provider: "hermes", hermesProfile: "override", hermesMaxTurns: 7 },
	);
});

test("rejects malformed review configuration", () => {
	assert.throws(
		() => resolveReviewSettings("hermes"),
		/transcribe\.review must be an object/,
	);
	assert.throws(
		() => resolveReviewSettings({ provider: "hermes", hermes: "default" }),
		/transcribe\.review\.hermes must be an object/,
	);
	assert.throws(
		() =>
			resolveReviewSettings({ provider: "hermes", hermes: { profile: 42 } }),
		/transcribe\.review\.hermes\.profile must be a string/,
	);
});
