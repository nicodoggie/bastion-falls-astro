import assert from "node:assert/strict";
import { test } from "node:test";

import { formatProgress, parseFfmpegProgressSeconds } from "./progress.js";

test("parses ffmpeg out_time_us progress", () => {
  assert.equal(parseFfmpegProgressSeconds("out_time_us=2500000\nprogress=continue"), 2.5);
});

test("parses ffmpeg out_time_ms progress as microseconds", () => {
  assert.equal(parseFfmpegProgressSeconds("out_time_ms=1500000\nprogress=continue"), 1.5);
});

test("falls back to hh:mm:ss progress time", () => {
  assert.equal(parseFfmpegProgressSeconds("out_time=00:01:02.500000"), 62.5);
});

test("formats bounded percent progress", () => {
  assert.equal(formatProgress("Chunk 1/2", 7.5, 10), "Chunk 1/2: 75.0% (00:00:07 / 00:00:10)");
  assert.equal(formatProgress("Chunk 1/2", 15, 10), "Chunk 1/2: 100.0% (00:00:10 / 00:00:10)");
});

