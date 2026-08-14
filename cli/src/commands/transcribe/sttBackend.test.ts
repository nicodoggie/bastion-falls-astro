import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSttBackend, transcribePass } from "./sttBackend.js";

const target = { name: "remote", provider: "openai-compatible" as const, protocol: "openai" as const, baseUrl: "http://127.0.0.1:1/v1", model: "model", timeoutSeconds: 1, retries: 0 };
const pass = { kind: "stereo" as const, id: "stereo" as const };

test("routes an OpenAI-compatible target only to the OpenAI adapter", async () => {
  const calls: string[] = [];
  const result = await transcribePass({ target, pass, chunks: [{ index: 0, path: "/tmp/chunk.flac" }], outDir: "/tmp/out", language: "en", force: false }, {
    openAi: async (request) => { calls.push(`${request.target.provider}:${request.chunk.index}`); return { segments: [] }; },
    nodejsWhisper: async () => { throw new Error("wrong local runner"); },
    fasterWhisper: async () => { throw new Error("wrong local runner"); },
  });
  assert.deepEqual(calls, ["openai-compatible:0"]);
  assert.deepEqual(result, [{ segments: [] }]);
  assert.throws(() => parseSttBackend("openai-compatible"), /Unsupported STT backend/);
  await assert.rejects(
    transcribePass({ target, pass: { kind: "channel", id: "../escape", channelIndex: 0 }, chunks: [], outDir: "/tmp/out", language: "en", force: false }, { openAi: async () => ({ segments: [] }) }),
    /invalid channel transcription pass/i,
  );
  await assert.rejects(
    transcribePass({ target: { name: "broken", provider: "nodejs-whisper" } as never, pass, chunks: [], outDir: "/tmp/out", language: "en", force: false }, {
      nodejsWhisper: async () => { throw new Error("malformed target reached runner"); },
    }),
    /Invalid resolved transcription target: model/,
  );
});
