import assert from "node:assert/strict";
import { test } from "node:test";

import { splitTextByLines } from "./ollamaNotes.js";

test("splits text on line boundaries under the target character budget", () => {
  assert.deepEqual(
    splitTextByLines(["alpha", "beta beta", "gamma", "delta"].join("\n"), 16),
    ["alpha\nbeta beta", "gamma\ndelta"],
  );
});

test("keeps oversized lines as their own chunk", () => {
  assert.deepEqual(splitTextByLines("short\nthis-line-is-too-long\nend", 8), [
    "short",
    "this-line-is-too-long",
    "end",
  ]);
});

