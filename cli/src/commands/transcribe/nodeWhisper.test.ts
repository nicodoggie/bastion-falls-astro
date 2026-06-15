import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  convertNodeWhisperRows,
  findNodeWhisperExecutable,
  nodeWhisperConfigureArgs,
  nodeWhisperExecutableCandidates,
  parseNodeWhisperTimestamp,
} from "./nodeWhisper.js";
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

test("lists nodejs-whisper executable candidates in CMake output locations", () => {
  assert.deepEqual(
    nodeWhisperExecutableCandidates("/tmp/nodejs-whisper").map((path) => path.replaceAll("\\", "/")),
    [
      "/tmp/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli",
      "/tmp/nodejs-whisper/cpp/whisper.cpp/build/bin/Release/whisper-cli",
      "/tmp/nodejs-whisper/cpp/whisper.cpp/build/bin/Debug/whisper-cli",
      "/tmp/nodejs-whisper/cpp/whisper.cpp/build/whisper-cli",
      "/tmp/nodejs-whisper/cpp/whisper.cpp/whisper-cli",
    ],
  );
});

test("finds an existing nodejs-whisper executable candidate", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "bf-nodejs-whisper-"));
  const executablePath = join(packageRoot, "cpp", "whisper.cpp", "build", "bin", "whisper-cli");
  await mkdir(join(packageRoot, "cpp", "whisper.cpp", "build", "bin"), { recursive: true });
  await writeFile(executablePath, "#!/bin/sh\n", "utf8");
  await chmod(executablePath, 0o755);

  assert.equal(await findNodeWhisperExecutable(packageRoot), executablePath);
});

test("configures nodejs-whisper builds without ccache", () => {
  assert.deepEqual(
    nodeWhisperConfigureArgs({
      withCuda: true,
      extraCmakeArgs: "-DGGML_NATIVE=OFF",
    }),
    ["-B", "build", "-DGGML_CCACHE=OFF", "-DGGML_CUDA=1", "-DGGML_NATIVE=OFF"],
  );
});
