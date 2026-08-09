import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTranscriptionProfile } from "./settings.js";

test("preserves the local single-pass default when profiles are absent", () => {
  assert.deepEqual(resolveTranscriptionProfile({}, undefined), {
    name: "legacy-local",
    layout: "stereo",
    target: {
      name: "legacy-local",
      provider: "nodejs-whisper",
      model: "large-v3-turbo",
    },
  });
});

test("resolves a named hybrid OpenAI-compatible profile", () => {
  const resolved = resolveTranscriptionProfile(
    {
      defaultProfile: "m1-hybrid",
      profiles: {
        "m1-hybrid": { layout: "hybrid", target: "m1-whisper" },
      },
      targets: {
        "m1-whisper": {
          provider: "openai-compatible",
          baseUrl: "http://ensu-macos:8000/v1",
          model: "large-v3-turbo",
        },
      },
    },
    undefined,
  );

  assert.equal(resolved.layout, "hybrid");
  assert.equal(resolved.target.provider, "openai-compatible");
  assert.equal(resolved.target.timeoutSeconds, 900);
  assert.equal(resolved.target.retries, 2);
});

test("rejects a profile that references an unknown target", () => {
  assert.throws(
    () =>
      resolveTranscriptionProfile(
        {
          defaultProfile: "broken",
          profiles: { broken: { layout: "hybrid", target: "missing" } },
          targets: {},
        },
        undefined,
      ),
    /unknown target.*missing/i,
  );
});
