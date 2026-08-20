import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BastionDate,
	bastionCalendar,
	defineCalendar,
} from "@bastion-falls/calendar";
import {
	type CharacterMortalityInput,
	getCurrentDeathDate,
	getOriginalBirthDate,
	resolveCharacterAge,
} from "../src/CharacterAge.js";

const d = (value: string) => BastionDate.from(value);
const current = "100-01-01 AI";

function mortality(
	status: CharacterMortalityInput["status"],
	phases: CharacterMortalityInput["phases"],
): CharacterMortalityInput {
	return { status, phases } as CharacterMortalityInput;
}

test("resolves ordinary open living history and closed death", () => {
	const living = resolveCharacterAge(
		{ mortality: mortality("alive", [{ type: "birth", from: "80 AI" }]) },
		current,
	);
	assert.equal(living.value, 20);
	assert.equal(living.source, "phases");
	const dead = resolveCharacterAge(
		{
			mortality: mortality("dead", [
				{ type: "birth", from: "80 AI", to: "100 AI" },
			]),
		},
		current,
	);
	assert.equal(dead.value, 20);
});

test("sums existence phases, excludes death gaps, and preserves zero durations", () => {
	const result = resolveCharacterAge(
		{
			mortality: mortality("undead", [
				{ type: "birth", from: "70 AI", to: "90 AI" },
				{ type: "undeath", from: "92 AI", to: "94 AI", species: "wight" },
			]),
		},
		current,
	);
	assert.equal(result.value, 22);
	assert.equal(result.phases[0]?.durationDays, 7200);
	assert.equal(
		resolveCharacterAge(
			{
				mortality: mortality("alive", [
					{ type: "birth", from: "100 AI", to: "100 AI" },
				]),
			},
			current,
		).value,
		0,
	);
});

test("combines repeated nonoverlapping fragments and same-date transitions", () => {
	const result = resolveCharacterAge(
		{
			mortality: mortality("alive", [
				{ type: "birth", from: "70 AI", to: "80 AI" },
				{ type: "revival", from: "82 AI", to: "90 AI", method: "spell" },
				{ type: "rebirth", from: "91 AI", to: "93 AI" },
			]),
		},
		current,
	);
	assert.equal(result.value, 20);
});

test("rejects overlapping repeated phases instead of summing them", () => {
	const result = resolveCharacterAge(
		{
			mortality: mortality("alive", [
				{ type: "birth", from: "70 AI", to: "80 AI" },
				{ type: "revival", from: "82 AI", to: "92 AI" },
				{ type: "rebirth", from: "91 AI", to: "93 AI" },
			]),
		},
		current,
	);
	assert.equal(result.value, undefined);
	assert.equal(result.derivedAge, undefined);
	assert.match(result.error ?? "", /overlap|chronolog/i);
});

test("accumulates exact sub-year fragments before flooring", () => {
	const result = resolveCharacterAge(
		{
			mortality: mortality("dead", [
				{ type: "birth", from: "80-01-01 AI", to: "80-07-01 AI" },
				{ type: "revival", from: "81-01-01 AI", to: "81-07-01 AI" },
			]),
		},
		current,
	);
	assert.equal(result.value, 1);
	assert.equal(result.approximate, undefined);
});

test("accumulates approximate multi-fragment phases and propagates approximation", () => {
	const result = resolveCharacterAge(
		{
			mortality: mortality("dead", [
				{ type: "birth", from: "80-01 AI", to: "81-07 AI" },
				{ type: "revival", from: "82-01 AI", to: "82-07 AI" },
			]),
		},
		current,
	);
	assert.equal(result.value, 2);
	assert.equal(result.approximate, true);
	assert.equal(
		result.phases.every((phase: { approximate: boolean }) => phase.approximate),
		true,
	);
});

test("downgrades mixed precision and propagates approximation", () => {
	const result = resolveCharacterAge(
		{
			mortality: mortality("dead", [
				{ type: "birth", from: "80-02 AI", to: "100-02 AI" },
			]),
		},
		current,
	);
	assert.equal(result.value, 20);
	assert.equal(result.approximate, true);
	assert.equal(result.phases[0]?.approximate, true);
});

test("validates runtime mortality variants before resolving phases", () => {
	const invalidCases: Array<[string, unknown]> = [
		["malformed status", { status: "missing", phases: [] }],
		[
			"birth method",
			{
				status: "dead",
				phases: [
					{ type: "birth", from: "80 AI", to: "81 AI", method: "spell" },
				],
			},
		],
		[
			"undeath species",
			{
				status: "undead",
				phases: [{ type: "undeath", from: "80 AI", to: "81 AI" }],
			},
		],
		[
			"species type",
			{
				status: "undead",
				phases: [{ type: "undeath", from: "80 AI", to: "81 AI", species: 42 }],
			},
		],
		[
			"method type",
			{
				status: "dead",
				phases: [{ type: "revival", from: "80 AI", to: "81 AI", method: 42 }],
			},
		],
		[
			"unknown key",
			{
				status: "dead",
				phases: [{ type: "birth", from: "80 AI", to: "81 AI", extra: true }],
			},
		],
		[
			"invalid phase shape",
			{
				status: "dead",
				phases: [{ type: "not-a-phase", from: "80 AI", to: "81 AI" }],
			},
		],
		[
			"invalid date type",
			{ status: "dead", phases: [{ type: "birth", from: 80, to: "81 AI" }] },
		],
	];
	for (const [label, value] of invalidCases) {
		const result = resolveCharacterAge(
			{ age: 7, mortality: value as CharacterMortalityInput },
			current,
		);
		assert.equal(result.value, 7, label);
		assert.equal(result.derivedAge, undefined, label);
		assert.match(
			result.error ?? "",
			/invalid|requires|species|method|key|phase|string|bound/i,
			label,
		);
	}
});

test("rejects missing, malformed, backward, and foreign dates without plausible derived age", () => {
	for (const phases of [
		[
			{ type: "birth", from: "80 AI" },
			{ type: "revival", from: "90 AI", to: "91 AI" },
		],
		[{ type: "birth", from: "not a date", to: "90 AI" }],
		[{ type: "birth", from: "90 AI", to: "80 AI" }],
	] as CharacterMortalityInput["phases"][]) {
		assert.equal(
			resolveCharacterAge({ mortality: mortality("dead", phases) }, current)
				.value,
			undefined,
		);
		assert.ok(
			resolveCharacterAge({ mortality: mortality("dead", phases) }, current)
				.error,
		);
	}
	const foreign = defineCalendar({
		...bastionCalendar.definition,
		id: "foreign",
	});
	const result = resolveCharacterAge(
		{
			mortality: mortality("dead", [
				{
					type: "birth",
					from: foreign.dateFrom({ era: "AI", year: 80 }),
					to: "90 AI",
				},
			]),
		},
		current,
	);
	assert.equal(result.value, undefined);
	assert.match(result.error ?? "", /calendar/i);
});

test("authored overrides win while valid derived age remains exposed", () => {
	const mortalityInput = mortality("dead", [
		{ type: "birth", from: "80 AI", to: "100 AI" },
	]);
	const matching = resolveCharacterAge(
		{ age: 20, mortality: mortalityInput },
		current,
	);
	assert.equal(matching.value, 20);
	assert.equal(matching.source, "authored");
	assert.equal(matching.authoredAge, 20);
	assert.equal(matching.derivedAge, 20);
	const conflicting = resolveCharacterAge(
		{ age: 7, mortality: mortalityInput },
		current,
	);
	assert.equal(conflicting.value, 7);
	assert.equal(conflicting.source, "authored");
	assert.equal(conflicting.authoredAge, 7);
	assert.equal(conflicting.derivedAge, 20);
});

test("handles empty histories and authored override precedence including zero", () => {
	assert.deepEqual(
		resolveCharacterAge({ mortality: mortality("unknown", []) }, current),
		{ phases: [] },
	);
	const result = resolveCharacterAge(
		{ age: 0, mortality: mortality("dead", [{ type: "birth", from: "bad" }]) },
		current,
	);
	assert.equal(result.value, 0);
	assert.equal(result.source, "authored");
	assert.equal(result.authoredAge, 0);
	assert.ok(result.error);
	assert.equal(resolveCharacterAge({ age: -1 }, current).value, undefined);
	assert.ok(resolveCharacterAge({ age: -1 }, current).error);
});

test("only matching final states infer current and mismatches stay incomplete", () => {
	assert.equal(
		resolveCharacterAge(
			{ mortality: mortality("dead", [{ type: "birth", from: "80 AI" }]) },
			current,
		).value,
		undefined,
	);
	assert.equal(
		resolveCharacterAge(
			{
				mortality: mortality("alive", [
					{ type: "undeath", from: "80 AI", species: "wight" },
				]),
			},
			current,
		).value,
		undefined,
	);
	assert.equal(
		resolveCharacterAge(
			{
				mortality: mortality("undead", [
					{
						type: "undeath",
						from: "80 AI",
						to: "100-01-01 AI",
						species: "wight",
					},
				]),
			},
			current,
		).value,
		20,
	);
});

test("accepts bound CalendarDate without reparsing and rejects foreign CalendarDate", () => {
	const result = resolveCharacterAge(
		{
			mortality: mortality("dead", [
				{ type: "birth", from: d("80 AI"), to: d("90 AI") },
			]),
		},
		d(current),
	);
	assert.equal(result.value, 10);
	const foreign = defineCalendar({
		...bastionCalendar.definition,
		id: "foreign",
	});
	const invalid = resolveCharacterAge(
		{
			mortality: mortality("dead", [
				{
					type: "birth",
					from: foreign.dateFrom({ era: "AI", year: 80 }),
					to: d("90 AI"),
				},
			]),
		},
		d(current),
	);
	assert.equal(invalid.value, undefined);
});

test("exposes original birth and current death anchors", () => {
	const living = mortality("alive", [
		{ type: "birth", from: "80 AI", to: "90 AI" },
		{ type: "revival", from: "95 AI" },
	]);
	assert.equal(getOriginalBirthDate(living), "80 AI");
	assert.equal(getCurrentDeathDate(living), undefined);
	const dead = mortality("dead", [
		{ type: "birth", from: "80 AI", to: "90 AI" },
		{ type: "revival", from: "92 AI", to: "96 AI" },
	]);
	assert.equal(getCurrentDeathDate(dead), "96 AI");
	const undead = mortality("undead", [
		{ type: "birth", from: "80 AI", to: "90 AI" },
		{ type: "undeath", from: "90 AI", to: "96 AI", species: "wight" },
	]);
	assert.equal(getCurrentDeathDate(undead), "90 AI");
	assert.equal(
		getOriginalBirthDate({
			status: "unknown",
			phases: [{ type: "birth", from: "bad" }],
		} as CharacterMortalityInput),
		undefined,
	);
});
