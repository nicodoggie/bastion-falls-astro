import assert from "node:assert/strict";
import test from "node:test";

import { parsePrivateRedactionsYaml } from "./privacy.js";
import { findUnsafePublicSpeakerLabels, redactTranscript } from "./transcriptRedaction.js";

function manifest(options?: { speakerLabels?: "preserve" | "neutralize"; transcripts?: string }): ReturnType<typeof parsePrivateRedactionsYaml> {
  return parsePrivateRedactionsYaml(`version: 1
reviewed: true
audio: []
transcripts:${options?.transcripts ?? " []"}
speakerLabels: ${options?.speakerLabels ?? "preserve"}
`);
}

test("redacts overlapping events once while preserving surrounding transcript structure", () => {
  const input = `# Session Transcript

Source: synthetic.flac

[00:00:00 - 00:00:01] Before.
[00:00:01 - 00:00:02] First private event.
[00:00:02 - 00:00:03] Second private event.
[00:00:03 - 00:00:04] After.
`;
  const result = redactTranscript(
    input,
    manifest({
      transcripts: `
  - id: synthetic-opening
    start: "00:00:01.000"
    end: "00:00:03.000"
    replacement: "[microphone identity check redacted]"`,
    }),
  );

  assert.equal(
    result.text,
    `# Session Transcript

Source: synthetic.flac

[00:00:00 - 00:00:01] Before.
[00:00:01.000 - 00:00:03.000] [microphone identity check redacted]
[00:00:03 - 00:00:04] After.
`,
  );
  assert.deepEqual(result.appliedRuleIds, ["synthetic-opening"]);
  assert.equal(result.redactionCount, 1);
  assert.equal(result.neutralizedSpeakerLabelCount, 0);
});

test("fails closed when a transcript rule applies to no event", () => {
  assert.throws(
    () =>
      redactTranscript(
        "[00:00:00 - 00:00:01] Public event.\n",
        manifest({
          transcripts: `
  - id: missing-event
    start: "00:01:00.000"
    end: "00:01:01.000"
    replacement: "[microphone identity check redacted]"`,
        }),
      ),
    /missing-event.*no timestamped event/i,
  );
});

test("neutralizes physical labels from public-safe channel evidence", () => {
  const input = `[00:00:00 - 00:00:01] [speaker:Example Person] [channel:left] Left line.
[00:00:01 - 00:00:02] [channel:right] [speaker:Another Person] Right line.
[00:00:02 - 00:00:03] [speaker:Unknown Person] Unmapped line.
[00:00:03 - 00:00:04] [speaker:left] [channel:left] Already safe.
`;
  const result = redactTranscript(input, manifest({ speakerLabels: "neutralize" }));

  assert.equal(
    result.text,
    `[00:00:00 - 00:00:01] [speaker:left] [channel:left] Left line.
[00:00:01 - 00:00:02] [channel:right] [speaker:right] Right line.
[00:00:02 - 00:00:03] Unmapped line.
[00:00:03 - 00:00:04] [speaker:left] [channel:left] Already safe.
`,
  );
  assert.equal(result.neutralizedSpeakerLabelCount, 3);
  assert.deepEqual(findUnsafePublicSpeakerLabels(result.text), []);
});

test("reports unsafe structural labels without treating dialogue names as labels", () => {
  const text = `[00:00:00 - 00:00:01] Example Person speaks in dialogue.
[00:00:01 - 00:00:02] [speaker:Example Person] Labelled line.
[00:00:02 - 00:00:03] [speaker:right] Safe line.
`;
  assert.deepEqual(findUnsafePublicSpeakerLabels(text), [{ line: 2 }]);
});
