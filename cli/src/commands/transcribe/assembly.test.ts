import assert from "node:assert/strict";
import { test } from "node:test";

import { assembleTranscript, formatChunkTranscript, formatTimestamp } from "./assembly.js";

test("formats seconds as hh:mm:ss timestamps", () => {
  assert.equal(formatTimestamp(3_661.4), "01:01:01");
});

test("assembles global timestamps and skips duplicate overlap segments", () => {
  const transcript = assembleTranscript({
    source: "/tmp/session.mp3",
    model: "large-v3-turbo",
    chunks: [
      {
        index: 0,
        start: 0,
        end: 10,
        overlapStart: 0,
        overlapEnd: 12,
        endReason: "exact-target",
        transcript: {
          segments: [
            { start: 1, end: 2, text: "Angel talks to Lime." },
            { start: 10.5, end: 11.5, text: "duplicate edge" },
          ],
        },
      },
      {
        index: 1,
        start: 10,
        end: 20,
        overlapStart: 8,
        overlapEnd: 20,
        endReason: "duration-end",
        transcript: {
          segments: [
            { start: 0.5, end: 1.5, text: "duplicate edge" },
            { start: 4, end: 5, text: "Tiphanie answers." },
          ],
        },
      },
    ],
  });

  assert.match(transcript, /\[00:00:01 - 00:00:02\] Angel talks to Lime\./);
  assert.doesNotMatch(transcript, /00:00:08/);
  assert.match(transcript, /\[00:00:12 - 00:00:13\] Tiphanie answers\./);
});

test("includes the selected backend in the transcript header", () => {
  const transcript = assembleTranscript({
    source: "/tmp/session.mp3",
    backend: "nodejs-whisper",
    model: "tiny",
    chunks: [],
  });

  assert.match(transcript, /Transcription: nodejs-whisper tiny/);
});

test("formats a single logical chunk transcript", () => {
  const transcript = formatChunkTranscript({
    index: 1,
    start: 10,
    end: 20,
    overlapStart: 8,
    overlapEnd: 22,
    endReason: "duration-end",
    transcript: {
      segments: [
        { start: 0.5, end: 1.5, text: "skip overlap" },
        { start: 4, end: 5, text: "Tiphanie answers." },
      ],
    },
  });

  assert.equal(transcript, "[00:00:12 - 00:00:13] Tiphanie answers.\n");
});
