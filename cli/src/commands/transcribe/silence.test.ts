import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSilencedetectOutput, trimChunksToSpeech } from "./silence.js";

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

test("trims long leading and trailing silence from chunks without moving global time", () => {
  const chunks = trimChunksToSpeech({
    chunks: [
      {
        index: 0,
        start: 0,
        end: 60,
        overlapStart: 0,
        overlapEnd: 65,
        endReason: "exact-target",
      },
    ],
    silences: [
      { start: 0, end: 8, duration: 8 },
      { start: 42, end: 65, duration: 23 },
    ],
    paddingSeconds: 1,
    minimumSpeechSeconds: 2,
  });

  assert.deepEqual(chunks, [
    {
      index: 0,
      start: 8,
      end: 42,
      overlapStart: 7,
      overlapEnd: 43,
      endReason: "exact-target",
    },
  ]);
});

test("drops chunks that are effectively all silence", () => {
  const chunks = trimChunksToSpeech({
    chunks: [
      {
        index: 0,
        start: 0,
        end: 30,
        overlapStart: 0,
        overlapEnd: 30,
        endReason: "duration-end",
      },
    ],
    silences: [{ start: 0, end: 30, duration: 30 }],
    paddingSeconds: 1,
    minimumSpeechSeconds: 2,
  });

  assert.deepEqual(chunks, []);
});
