import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chunkAudioPathFor,
  pairChunksWithArtifactPaths,
  parseChunkSelection,
  passAlignmentPathFor,
  passRawJsonPathFor,
  passRawMarkdownPathFor,
  requiredPasses,
} from "./passes.js";
import type { PreparedChannel } from "./audio.js";

const channels: PreparedChannel[] = [
  { id: "left", index: 0, path: "/tmp/left.flac" },
  { id: "right", index: 1, path: "/tmp/right.flac" },
];

test("selects bounded chunks and rejects malformed selectors", () => {
  const cases = [
    [undefined, [0, 1, 2, 4, 7]],
    ["0", [0]],
    ["0-2", [0, 1, 2]],
    ["0,4,7,4", [0, 4, 7]],
  ] as const;
  for (const [value, expected] of cases) assert.deepEqual(parseChunkSelection(value, [0, 1, 2, 4, 7]), expected);
  for (const value of ["3", "-1", "2-0", "", "0,,2", "wat", "0-2-3"]) {
    assert.throws(() => parseChunkSelection(value, [0, 1, 2]), /chunk selection/i, value);
  }
});

test("requires stereo only for stereo and stereo plus prepared channels for hybrid", () => {
  assert.deepEqual(requiredPasses("stereo", channels), [{ kind: "stereo", id: "stereo" }]);
  assert.deepEqual(requiredPasses("hybrid", channels), [
    { kind: "stereo", id: "stereo" },
    { kind: "channel", id: "left", channelIndex: 0 },
    { kind: "channel", id: "right", channelIndex: 1 },
  ]);
});

test("namespaces channel artifacts while preserving stereo defaults", () => {
  assert.match(chunkAudioPathFor("/tmp/out/chunks", { kind: "stereo", id: "stereo" }, 2), /chunks\/session_002\.flac$/);
  assert.match(chunkAudioPathFor("/tmp/out/chunks", { kind: "channel", id: "left", channelIndex: 0 }, 2), /chunks\/passes\/left\/session_002\.flac$/);
  assert.match(passRawJsonPathFor("/tmp/out/raw_chunks", { kind: "channel", id: "left", channelIndex: 0 }, 2), /raw_chunks\/passes\/left\/session_002\.json$/);
  assert.match(passRawMarkdownPathFor("/tmp/out/raw_transcription", { kind: "stereo", id: "stereo" }, 2), /raw_transcription\/session_002\.md$/);
  assert.match(passAlignmentPathFor("/tmp/out", { kind: "channel", id: "left", channelIndex: 0 }), /alignment\/left\.json$/);
});

test("rejects unsafe passes at the exported path boundary", () => {
  const unsafe = [
    { kind: "channel", id: "../escape", channelIndex: 0 },
    { kind: "channel", id: "left/right", channelIndex: 0 },
    { kind: "channel", id: "stereo", channelIndex: 0 },
    { kind: "channel", id: "", channelIndex: 0 },
    { kind: "channel", id: "left", channelIndex: -1 },
  ] as never[];
  for (const pass of unsafe) assert.throws(() => chunkAudioPathFor("/tmp/chunks", pass, 0), /invalid/i);
  assert.throws(() => passAlignmentPathFor("/tmp/out", { kind: "stereo", id: "stereo", extra: true } as never), /invalid/i);
  assert.throws(() => requiredPasses("hybrid", [
    { id: "left", index: 1, path: "/tmp/left.flac" },
  ]), /contiguous/i);
});

test("pairs bounded artifacts with their selected manifest chunks", () => {
  assert.deepEqual(
    pairChunksWithArtifactPaths([{ index: 4 }], ["/tmp/raw_chunks/session_004.json"]),
    [{ chunk: { index: 4 }, artifactPath: "/tmp/raw_chunks/session_004.json" }],
  );
  assert.throws(
    () => pairChunksWithArtifactPaths([{ index: 4 }], []),
    /artifact count must match/i,
  );
});
