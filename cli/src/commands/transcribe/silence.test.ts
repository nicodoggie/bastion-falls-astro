import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSilencedetectOutput } from "./silence.js";

test("parses ffmpeg silencedetect output into intervals", () => {
  const output = [
    "[silencedetect @ 0x123] silence_start: 12.34",
    "[silencedetect @ 0x123] silence_end: 13.02 | silence_duration: 0.68",
    "[silencedetect @ 0x123] silence_start: 598.4",
    "[silencedetect @ 0x123] silence_end: 600.1 | silence_duration: 1.7",
  ].join("\n");

  assert.deepEqual(parseSilencedetectOutput(output), [
    { start: 12.34, end: 13.02, duration: 0.68 },
    { start: 598.4, end: 600.1, duration: 1.7 },
  ]);
});

test("ignores unmatched silence starts", () => {
  assert.deepEqual(parseSilencedetectOutput("silence_start: 10"), []);
});
