import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_REDACTIONS_FILENAME,
  PUBLIC_PRIVACY_RECEIPT_FILENAME,
  parsePrivateRedactionsYaml,
  parsePublicPrivacyReceiptYaml,
  serializePublicPrivacyReceipt,
  timestampToSeconds,
} from "./privacy.js";

test("privacy archive filenames and timestamp parsing are stable", () => {
  assert.equal(PRIVATE_REDACTIONS_FILENAME, "redactions.yaml");
  assert.equal(PUBLIC_PRIVACY_RECEIPT_FILENAME, "privacy-review.yaml");
  assert.equal(timestampToSeconds("00:00:00.000"), 0);
  assert.equal(timestampToSeconds("01:02:03.250"), 3723.25);
  assert.throws(() => timestampToSeconds("00:00:03.000x"));
});

test("private manifest accepts an explicitly reviewed empty audit", () => {
  assert.deepEqual(
    parsePrivateRedactionsYaml(`version: 1
reviewed: true
audio: []
transcripts: []
speakerLabels: preserve
`),
    {
      version: 1,
      reviewed: true,
      audio: [],
      transcripts: [],
      speakerLabels: "preserve",
    },
  );
});

test("private manifest parses strict v1 audio and transcript rules", () => {
  const manifest = parsePrivateRedactionsYaml(`version: 1
reviewed: true
audio:
  - id: clip-a
    start: "00:00:01.000"
    end: "00:00:02.500"
    channels: all
    reason: physical-speaker-identity
    fadeMilliseconds: 25
transcripts:
  - id: line-a
    start: "00:00:03.000"
    end: "00:00:04.000"
    replacement: "[microphone identity check redacted]"
speakerLabels: neutralize
`);
  assert.deepEqual(manifest, {
    version: 1,
    reviewed: true,
    audio: [{ id: "clip-a", start: "00:00:01.000", end: "00:00:02.500", channels: "all", reason: "physical-speaker-identity", fadeMilliseconds: 25 }],
    transcripts: [{ id: "line-a", start: "00:00:03.000", end: "00:00:04.000", replacement: "[microphone identity check redacted]" }],
    speakerLabels: "neutralize",
  });
});

test("private manifest defaults fade and rejects unsafe or ambiguous input", () => {
  const base = `version: 1\nreviewed: true\naudio:\n  - id: clip-a\n    start: "00:00:01.000"\n    end: "00:00:02.000"\n    channels: all\n    reason: physical-speaker-identity\ntranscripts: []\nspeakerLabels: preserve\n`;
  assert.equal(parsePrivateRedactionsYaml(base).audio[0]?.fadeMilliseconds, 20);
  for (const mutation of [
    base.replace("id: clip-a", "id: clip-a\n    extra: nope"),
    base.replace("channels: all", "channels: left"),
    base.replace("reviewed: true", "reviewed: false"),
    base.replace("transcripts: []", "transcripts:\n  - id: x\n    start: \"00:00:01.000\"\n    end: \"00:00:01.000\"\n    replacement: \"other\""),
    base.replace("id: clip-a", "id: clip-a\n  - id: clip-a"),
    base.replace('start: "00:00:01.000"', 'start: "-01:00:00.000"'),
    base.replace('end: "00:00:02.000"', 'end: "00:00:01.000"'),
    base.replace('end: "00:00:02.000"', 'end: "00:00:Infinity"'),
    base.replace('id: clip-a', 'id: ""'),
    base.replace('speakerLabels: preserve', 'speakerLabels: arbitrary'),
    base.replace('version: 1', 'version: 2'),
  ]) assert.throws(() => parsePrivateRedactionsYaml(mutation));
  assert.throws(() => parsePrivateRedactionsYaml("a: &x {version: 1}\nb: *x\n"));
  assert.throws(() => parsePrivateRedactionsYaml("!custom {version: 1}\n"));
});

test("public receipt is strict, private-field-free, and round trips", () => {
  const receipt = parsePublicPrivacyReceiptYaml(`version: 1
reviewed: true
policy: transcript-archive-privacy-v1
audioRedactionsApplied: 2
transcriptRedactionsApplied: 3
speakerLabels: preserved
`);
  assert.deepEqual(receipt, {
    version: 1,
    reviewed: true,
    policy: "transcript-archive-privacy-v1",
    audioRedactionsApplied: 2,
    transcriptRedactionsApplied: 3,
    speakerLabels: "preserved",
  });
  const serialized = serializePublicPrivacyReceipt(receipt);
  assert.equal(serialized.endsWith("\n"), true);
  assert.deepEqual(parsePublicPrivacyReceiptYaml(serialized), receipt);
  for (const field of ["timestamps", "names", "paths", "ruleIds", "redactions.yaml"]) {
    assert.throws(() => parsePublicPrivacyReceiptYaml(`version: 1\nreviewed: true\npolicy: transcript-archive-privacy-v1\naudioRedactionsApplied: 0\ntranscriptRedactionsApplied: 0\nspeakerLabels: preserved\n${field}: synthetic\n`));
  }
  assert.throws(() => parsePublicPrivacyReceiptYaml("version: 1\nreviewed: true\npolicy: transcript-archive-privacy-v1\naudioRedactionsApplied: -1\ntranscriptRedactionsApplied: 0\nspeakerLabels: preserved\n"));
});
