import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BastionDate } from "@bastion-falls/calendar";
import {
  type CharacterAgeDetails,
  canResolveCharacterAge,
  resolveCharacterAge,
} from "./character-age.ts";

const currentDate = BastionDate.from("1275-01-01 AI");

function resolve(details: CharacterAgeDetails): number | undefined {
  return resolveCharacterAge(details, currentDate);
}

describe("resolveCharacterAge", () => {
  it("loads the campaign date only for usable derivation inputs", () => {
    assert.equal(
      canResolveCharacterAge({ age: 0, dateOfBirth: "1270 AI" }),
      false,
    );
    assert.equal(canResolveCharacterAge({ dateOfBirth: "" }), false);
    assert.equal(
      canResolveCharacterAge({
        dateOfBirth: "1270-01-01 AI",
        dateOfDeath: " ",
        mortality: "dead",
      }),
      false,
    );
    assert.equal(
      canResolveCharacterAge({ dateOfBirth: "1270-01-01 AI" }),
      true,
    );
  });

  it("gives authored ages precedence, including zero and bad dates", () => {
    assert.equal(resolve({ age: 0, dateOfBirth: "not a date" }), 0);
    assert.equal(resolve({ age: 42, dateOfBirth: "1270-01-01 AI" }), 42);
  });

  it("derives living ages against the supplied current date", () => {
    assert.equal(
      resolve({ dateOfBirth: "1270-01-01 AI", mortality: "alive" }),
      5,
    );
  });

  it("derives dead ages against a complete date of death", () => {
    assert.equal(
      resolve({
        dateOfBirth: "1270-01-01 AI",
        dateOfDeath: "1274-12-30 AI",
        mortality: "dead",
      }),
      4,
    );
  });

  it("uses the current date for undead, unknown, and absent mortality", () => {
    for (const mortality of ["undead", "unknown", undefined] as const) {
      assert.equal(resolve({ dateOfBirth: "1270-01-01 AI", mortality }), 5);
    }
  });

  it("returns undefined for missing, partial, or malformed birth dates", () => {
    assert.equal(resolve({}), undefined);
    assert.equal(resolve({ dateOfBirth: "1270 AI" }), undefined);
    assert.equal(resolve({ dateOfBirth: "bad" }), undefined);
  });

  it("returns undefined for incomplete or malformed dead dates", () => {
    assert.equal(
      resolve({ dateOfBirth: "1270-01-01 AI", mortality: "dead" }),
      undefined,
    );
    assert.equal(
      resolve({
        dateOfBirth: "1270-01-01 AI",
        dateOfDeath: "1274 AI",
        mortality: "dead",
      }),
      undefined,
    );
    assert.equal(
      resolve({
        dateOfBirth: "1270-01-01 AI",
        dateOfDeath: "bad",
        mortality: "dead",
      }),
      undefined,
    );
  });

  it("returns undefined for a future birth or death before birth", () => {
    assert.equal(resolve({ dateOfBirth: "1276-01-01 AI" }), undefined);
    assert.equal(
      resolve({
        dateOfBirth: "1270-01-01 AI",
        dateOfDeath: "1269-12-30 AI",
        mortality: "dead",
      }),
      undefined,
    );
  });

  it("preserves an exact derived zero age", () => {
    assert.equal(
      resolve({ dateOfBirth: "1275-01-01 AI", mortality: "alive" }),
      0,
    );
  });
});
