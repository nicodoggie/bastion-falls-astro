import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadCreatureFromContentJson,
  resolveCreatureFromData,
} from "./creature-data.ts";
import { loadCreature } from "./creatures.ts";

test("resolves inline creature data into tooltip payload", () => {
  const resolved = resolveCreatureFromData(
    {
      name: "Lantern Drake",
      size: ["S"],
      type: "dragon",
      alignment: ["N"],
      ac: [14],
      hp: { average: 22, formula: "4d6 + 8" },
      speed: { walk: 30, fly: 40 },
      str: 12,
      dex: 16,
      con: 14,
      int: 6,
      wis: 12,
      cha: 10,
      passive: 11,
      cr: "1",
      trait: [
        {
          name: "Glowing Hide",
          entries: ["The drake sheds {@i dim light} in a 10-foot radius."],
        },
      ],
    },
    "test inline creature",
  );

  assert.equal(resolved?.record.name, "Lantern Drake");
  assert.deepEqual(resolved?.summaryLines, [
    "Small dragon · Neutral",
    "CR 1 · AC 14 · HP 22",
  ]);
  assert.equal(resolved?.body, "Glowing Hide. The drake sheds dim light in a 10-foot radius.");
});

test("loads creature JSON relative to content docs", () => {
  const resolved = loadCreatureFromContentJson(
    "world/characters/deathengel.creature.json",
  );

  assert.equal(resolved?.record.name, "Deathengel, the Celestial Avenger");
  assert.ok(resolved?.summaryLines.some((line) => line.includes("CR 19")));
  assert.match(resolved?.body ?? "", /Deathengel knows if it hears a lie/);
});

test("defaults bundled creature lookups to the revised Monster Manual", () => {
  assert.equal(loadCreature("Ancient Red Dragon")?.record.source, "XMM");
});
