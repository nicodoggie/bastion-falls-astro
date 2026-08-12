import assert from "node:assert/strict";
import { test } from "node:test";

import { alignHybridChunk, buildHybridCorrectionContext, isAlignmentArtifactName, type AlignmentInput } from "./alignment.js";

test("aligns stereo primary speech with conservative bleed and physical-speaker evidence", () => {
  assert.equal(isAlignmentArtifactName("session_000.json"), true);
  assert.equal(isAlignmentArtifactName("session_\\d+.json"), false);
  const input: AlignmentInput = {
    chunkStart: 100,
    stereo: [
      { start: 1, end: 4, text: "Meet me at Highbury tonight", confidence: 0.92 },
      { start: 5, end: 8, text: "I found the old map", confidence: 0.9 },
    ],
    channels: [
      { passId: "left", channelId: "left", segmentEnergies: [0.88, 0.88], segments: [
        { start: 1.1, end: 4, text: "Meet me at Highbury tonight", confidence: 0.8 },
        { start: 5, end: 8, text: "I found the old map", confidence: 0.8 },
      ] },
      { passId: "right", channelId: "right", segmentEnergies: [0.12, 0.12], segments: [
        { start: 1.2, end: 3.9, text: "Meet me at Highberry tonight", confidence: 0.7 },
        { start: 5, end: 8, text: "No, I burned the old map", confidence: 0.7 },
      ] },
    ],
    channelMap: {
      left: { speaker: "Nico", expectedCharacters: ["Nico", "Ran"] },
      right: { speaker: "Ran", expectedCharacters: ["Ran"] },
    },
  };

  const result = alignHybridChunk(input);
  assert.deepEqual(result.events.map((event) => event.text), [
    "Meet me at Highbury tonight",
    "I found the old map",
    "No, I burned the old map",
  ]);
  assert.equal(result.events[0]?.alternatives[0]?.text, "Meet me at Highberry tonight");
  assert.equal(result.events[0]?.alternatives[0]?.sourcePass, "right");
  assert.equal(result.events[0]?.physicalSpeaker, "Nico");
  assert.equal(result.events[0]?.channel, "left");
  assert.equal(result.events[1]?.physicalSpeaker, undefined);
  assert.equal(result.events[2]?.physicalSpeaker, undefined);
  assert.equal(result.events[2]?.character, undefined);
  assert.equal(result.events[0]?.alternatives[0]?.relativeEnergy, 0.12);
  assert.equal(result.events[0]?.globalStart, 101);
  assert.equal(result.events[0]?.globalEnd, 104);
  const context = buildHybridCorrectionContext([result], {
    version: 1,
    source: "/source.wav",
    channels: [
      { id: "left", index: 0, speakers: [{ name: "Nico", role: "player", expectedCharacters: [{ name: "Andrew", aliases: [] }, { name: "Sapphire", aliases: [] }] }] },
      { id: "right", index: 1, speakers: [{ name: "Ran", role: "player", expectedCharacters: [{ name: "Hellion", aliases: [] }] }] },
    ],
  });
  assert.match(context.channelEvidence, /alternative .*source:right.*relative-energy:0\.12.*Highberry/);
  assert.match(context.channelMapContext, /left: Nico; expected: Andrew, Sapphire/);
});
