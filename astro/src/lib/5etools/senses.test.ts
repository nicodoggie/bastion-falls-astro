import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSense } from "./senses.ts";

test("defaults sense lookups to revised XPHB entries", () => {
  const resolved = loadSense("darkvision");

  assert.equal(resolved?.record.name, "Darkvision");
  assert.equal(resolved?.record.source, "XPHB");
  assert.deepEqual(resolved?.summaryLines, ["Sense", "Source XPHB"]);
  assert.match(resolved?.body ?? "", /If you have Darkvision/);
});

test("loads a sense from an explicit source", () => {
  const resolved = loadSense("tremorsense", "mm");

  assert.equal(resolved?.record.name, "Tremorsense");
  assert.equal(resolved?.record.source, "MM");
});
