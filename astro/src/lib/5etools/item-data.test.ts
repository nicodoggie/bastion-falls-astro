import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadItemFromContentJson,
  resolveItemFromData,
} from "./item-data.ts";
import { loadItem } from "./items.ts";

test("resolves inline item data into tooltip payload", () => {
  const resolved = resolveItemFromData(
    {
      name: "Lantern of Small Suns",
      source: "BF",
      type: "Wondrous item",
      rarity: "rare",
      reqAttune: true,
      entries: ["This lantern sheds {@i impossible} light."],
    },
    "test inline item",
  );

  assert.equal(resolved?.record.name, "Lantern of Small Suns");
  assert.deepEqual(resolved?.summaryLines, [
    "Wondrous item · Rare · requires attunement",
  ]);
  assert.equal(resolved?.body, "This lantern sheds impossible light.");
});

test("loads item JSON relative to content docs", () => {
  const resolved = loadItemFromContentJson(
    "world/misc/examples/potion-of-healing.item.json",
  );

  assert.equal(resolved?.record.name, "Potion of Healing");
  assert.ok(resolved?.summaryLines.includes("P · Common"));
  assert.match(resolved?.body ?? "", /regains 2d4 \+ 2 hit points/);
});

test("defaults bundled item lookups to revised 2024 sources", () => {
  assert.equal(loadItem("Alchemist's Supplies")?.record.source, "XPHB");
  assert.equal(loadItem("+1 Wand of the War Mage")?.record.source, "XDMG");
});
