import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOpusArgs } from "./encode.js";

test("builds ffmpeg args preserving stereo for a compact speech-tuned opus encode", () => {
  const args = buildOpusArgs({
    input: "/t/session.flac",
    output: "/tmp/out.opus",
    bitrate: "32k",
    force: true,
  });

  assert.deepEqual(args, [
    "-hide_banner",
    "-nostats",
    "-progress",
    "pipe:1",
    "-y",
    "-i",
    "/t/session.flac",
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    "32k",
    "-application",
    "voip",
    "/tmp/out.opus",
  ]);
});

test("uses -n instead of -y when not forcing overwrite", () => {
  const args = buildOpusArgs({
    input: "/t/in.flac",
    output: "/t/out.opus",
    bitrate: "24k",
    force: false,
  });
  assert.ok(args.includes("-n"));
  assert.ok(!args.includes("-y"));
});
