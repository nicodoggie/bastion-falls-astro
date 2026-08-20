import assert from "node:assert/strict";
import test from "node:test";
import {
	CharacterMortalitySchema,
	MortalityPhaseTypeSchema,
	MortalityStatusSchema,
} from "../src/CharacterMortality.js";

const validPhase = {
	type: "birth" as const,
	from: "1-01-01 AI",
	to: "10-01-01 AI",
};

function parses(value: unknown): void {
	assert.doesNotThrow(() => CharacterMortalitySchema.parse(value));
}

function rejects(value: unknown): void {
	assert.throws(() => CharacterMortalitySchema.parse(value));
}

test("mortality status and phase type are closed enums", () => {
	assert.equal(MortalityStatusSchema.safeParse("alive").success, true);
	assert.equal(MortalityStatusSchema.safeParse("ghost").success, false);
	assert.equal(MortalityPhaseTypeSchema.safeParse("rebirth").success, true);
	assert.equal(MortalityPhaseTypeSchema.safeParse("death").success, false);
});

test("accepts sparse records and ordered repeated phases", () => {
	parses({ status: "alive", phases: [] });
	parses({ status: "unknown", phases: [validPhase] });
	parses({
		status: "undead",
		phases: [
			{ type: "birth", from: "1-01-01 AI" },
			{ type: "undeath", from: "20-01-01 AI", species: "  revenant  " },
			{ type: "revival", from: "21-01-01 AI", method: "ritual" },
			{ type: "rebirth", from: "22-01-01 AI", species: "human" },
			{ type: "undeath", from: "23-01-01 AI", species: "lich" },
		],
	});
});

test("requires species for undeath and non-empty strings for phase details", () => {
	rejects({ status: "undead", phases: [{ type: "undeath" }] });
	rejects({
		status: "undead",
		phases: [{ type: "undeath", species: "   " }],
	});
	rejects({ status: "alive", phases: [{ type: "birth", from: "  " }] });
	parses({
		status: "undead",
		phases: [{ type: "undeath", species: "  vampire  " }],
	});
});

test("allows method only on revival and rebirth", () => {
	parses({
		status: "unknown",
		phases: [{ type: "revival", method: "divine intervention" }],
	});
	parses({ status: "unknown", phases: [{ type: "rebirth", method: "cycle" }] });
	rejects({
		status: "alive",
		phases: [{ type: "birth", method: "caesarean" }],
	});
	rejects({
		status: "undead",
		phases: [{ type: "undeath", species: "lich", method: "curse" }],
	});
});

test("requires an undeath phase for undead status", () => {
	rejects({ status: "undead", phases: [{ type: "birth" }] });
	parses({ status: "dead", phases: [] });
});

test("rejects precise backward, overlapping, and obviously open dead histories", () => {
	rejects({
		status: "alive",
		phases: [{ type: "birth", from: "10-01-02 AI", to: "10-01-01 AI" }],
	});
	rejects({
		status: "unknown",
		phases: [
			{ type: "birth", from: "1-01-01 AI", to: "10-01-10 AI" },
			{ type: "revival", from: "10-01-05 AI", to: "10-01-20 AI" },
		],
	});
	rejects({
		status: "dead",
		phases: [{ type: "birth", from: "1-01-01 AI" }],
	});
	parses({
		status: "dead",
		phases: [{ type: "birth", from: "1-01-01 AI", to: "10-01-01 AI" }],
	});
});

test("does not guess across mixed date precision", () => {
	parses({
		status: "unknown",
		phases: [
			{ type: "birth", from: "1 AI", to: "10 AI" },
			{ type: "revival", from: "10-01-01 AI" },
		],
	});
});

assert.equal(typeof CharacterMortalitySchema.parse, "function");
