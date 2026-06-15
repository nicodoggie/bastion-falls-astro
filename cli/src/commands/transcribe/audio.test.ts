import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAudioFilter } from "./audio.js";

test("builds the default speech normalization filter", () => {
  assert.equal(
    buildAudioFilter({}),
    "highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11",
  );
});

test("runs denoise and voice boost before loudness normalization", () => {
  assert.equal(
    buildAudioFilter({ denoise: true, voiceBoost: true }),
    [
      "afftdn",
      "highpass=f=80",
      "lowpass=f=8000",
      "equalizer=f=3000:t=q:w=1:g=3",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
    ].join(","),
  );
});
