import assert from "node:assert/strict";
import { test } from "node:test";
import { BastionDate } from "@bastion-falls/calendar";
import type {
	ResolvedCharacterAge,
	ResolvedMortalityPhase,
} from "@bastion-falls/types/CharacterAge";
import {
	describeCharacterAge,
	describeMortalityPhase,
} from "./characterAgeDetail.ts";

const date = (value: string) => BastionDate.from(value);
const phase = (
	value: Partial<ResolvedMortalityPhase> & Pick<ResolvedMortalityPhase, "type">,
): ResolvedMortalityPhase => ({ approximate: false, open: false, ...value });
const age = (value: Partial<ResolvedCharacterAge>): ResolvedCharacterAge => ({
	approximate: false,
	phases: [],
	...value,
});

test("uses the approved event and duration phrases for every phase", () => {
	assert.deepEqual(
		describeMortalityPhase(
			phase({
				type: "birth",
				from: date("1 AI"),
				to: date("21 AI"),
				durationDays: 7200,
			}),
		),
		{
			event: "Born",
			date: "1 AI",
			duration: "Lived for 20 years",
		},
	);
	assert.equal(
		describeMortalityPhase(
			phase({
				type: "birth",
				from: date("1 AI"),
				to: date("21 AI"),
				open: true,
				durationDays: 7200,
			}),
		).duration,
		"Alive for 20 years",
	);
	assert.equal(
		describeMortalityPhase(
			phase({
				type: "undeath",
				from: date("21 AI"),
				to: date("31 AI"),
				durationDays: 3600,
			}),
		).event,
		"Became undead",
	);
	assert.equal(
		describeMortalityPhase(
			phase({
				type: "undeath",
				from: date("21 AI"),
				to: date("31 AI"),
				open: true,
				durationDays: 3600,
			}),
		).duration,
		"Undead for 10 years",
	);
	assert.equal(
		describeMortalityPhase(
			phase({
				type: "revival",
				from: date("31 AI"),
				to: date("41 AI"),
				durationDays: 3600,
			}),
		).duration,
		"Lived again for 10 years",
	);
	assert.equal(
		describeMortalityPhase(
			phase({
				type: "rebirth",
				from: date("41 AI"),
				to: date("51 AI"),
				open: true,
				durationDays: 3600,
			}),
		).duration,
		"Living this life for 10 years",
	);
});

test("keeps species and method separate, and marks approximate durations", () => {
	const result = describeMortalityPhase(
		phase({
			type: "undeath",
			from: date("21 AI"),
			to: date("31 AI"),
			open: true,
			species: "vampire",
			method: "ritual",
			durationDays: 3600,
			approximate: true,
		}),
	);
	assert.deepEqual(result.species, "vampire");
	assert.deepEqual(result.method, "Via ritual");
	assert.equal(result.duration, "Undead for ~10 years");
});

test("does not present a to-only boundary as the phase event date", () => {
	const result = describeMortalityPhase(
		phase({ type: "birth", to: date("21 AI") }),
	);
	assert.equal(result.date, undefined);
	assert.equal(result.endDate, "21 AI");
});

test("omits phase rows that contain no meaningful history", () => {
	const result = describeCharacterAge(
		age({ value: 7, phases: [phase({ type: "birth" })] }),
	);
	assert.deepEqual(result.phases, []);
});

test("explains authored overrides without putting a marker in the collapsed value", () => {
	assert.equal(
		describeCharacterAge(
			age({ value: 7, authoredAge: 7, derivedAge: 20, source: "authored" }),
		).overrideExplanation,
		"Authored age (7) overrides the phase-derived age (20).",
	);
	assert.equal(
		describeCharacterAge(
			age({ value: 20, authoredAge: 20, derivedAge: 20, source: "authored" }),
		).overrideExplanation,
		"Authored age matches the phase-derived age.",
	);
	assert.equal(
		describeCharacterAge(
			age({
				value: 7,
				authoredAge: 7,
				source: "authored",
				phases: [phase({ type: "birth", from: date("1 AI") })],
			}),
		).overrideExplanation,
		"Authored age is provided; phase history is incomplete, so it cannot derive a total.",
	);
	const collapsedValue = describeCharacterAge(
		age({ value: 7, authoredAge: 7 }),
	).collapsedValue;
	assert.equal(collapsedValue, "7");
	assert.doesNotMatch(collapsedValue, /[*†‡]|override/i);
});
