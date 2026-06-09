import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAbilityScoreDisplay,
  formatSize,
  formatSpeed,
} from "./characterSidebarInfo.ts";

describe("character sidebar PC stat formatting", () => {
  it("formats ability scores as stacked score and modifier display parts", () => {
    assert.deepEqual(formatAbilityScoreDisplay(17), {
      modifier: "+3",
      score: "17",
    });
    assert.deepEqual(formatAbilityScoreDisplay(10), {
      modifier: "+0",
      score: "10",
    });
    assert.deepEqual(formatAbilityScoreDisplay(8), {
      modifier: "-1",
      score: "8",
    });
  });

  it("formats walking and alternate speeds", () => {
    assert.equal(formatSpeed({ base: 30 }), "30 ft.");
    assert.equal(
      formatSpeed({ base: 30, fly: 60, swim: 15 }),
      "30 ft., fly 60 ft., swim 15 ft.",
    );
    assert.equal(
      formatSpeed({ special: "equal to walking speed" }),
      "equal to walking speed",
    );
  });

  it("formats size labels", () => {
    assert.equal(formatSize("medium"), "Medium");
    assert.equal(formatSize("gargantuan"), "Gargantuan");
  });
});
