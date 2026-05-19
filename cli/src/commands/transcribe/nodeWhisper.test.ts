import assert from "node:assert/strict";
import { test } from "node:test";

import { convertNodeWhisperRows, parseNodeWhisperTimestamp } from "./nodeWhisper.js";
import { defaultSttBackend } from "./sttBackend.js";

test("uses nodejs-whisper as the default STT backend", () => {
  assert.equal(defaultSttBackend, "nodejs-whisper");
});

test("parses nodejs-whisper timestamps", () => {
  assert.equal(parseNodeWhisperTimestamp("00:01:02.500"), 62.5);
  assert.equal(parseNodeWhisperTimestamp("[00:01:02.500 --> 00:01:04.000]"), 62.5);
});

test("converts nodejs-whisper rows to the shared chunk transcript shape", () => {
  assert.deepEqual(
    convertNodeWhisperRows(
      [
        { start: "00:00:01.000", end: "00:00:02.500", speech: " Angel speaks. ", confidence: 0.75 },
        { start: "00:00:03.000", end: "00:00:04.000", text: "Lime answers." },
        { start: "bad", end: "00:00:05.000", speech: "skip me" },
      ],
      "session_000.flac",
    ),
    {
      chunk: "session_000.flac",
      segments: [
        { start: 1, end: 2.5, text: "Angel speaks.", confidence: 0.75 },
        { start: 3, end: 4, text: "Lime answers." },
      ],
    },
  );
});

test("converts whisper.cpp JSON transcription rows", () => {
  assert.deepEqual(
    convertNodeWhisperRows(
      [
        {
          timestamps: { from: "00:00:01,000", to: "00:00:02,500" },
          text: " Angel speaks. ",
        },
      ],
      "session_000.flac",
    ),
    {
      chunk: "session_000.flac",
      segments: [{ start: 1, end: 2.5, text: "Angel speaks." }],
    },
  );
});
