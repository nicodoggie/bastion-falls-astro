import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveContextRoot,
  resolveTranscribeSessionPaths,
} from "./sessionPaths.js";

test("keeps the default docs root config-relative while session paths use the config directory", () => {
  const configuredDocsRoot = "/repo/astro/src/content/docs";
  assert.equal(
    resolveContextRoot("/repo/astro", undefined, configuredDocsRoot),
    configuredDocsRoot,
  );
  assert.equal(
    resolveContextRoot("/repo/astro", undefined, configuredDocsRoot),
    configuredDocsRoot,
  );

  const sessionFromRoot = resolveTranscribeSessionPaths({
    cwd: "/repo",
    pathBase: "/repo/astro",
    audioFile: "recordings/session.wav",
  });
  const sessionFromAstro = resolveTranscribeSessionPaths({
    cwd: "/repo/astro",
    pathBase: "/repo/astro",
    audioFile: "recordings/session.wav",
  });
  assert.deepEqual(sessionFromAstro, sessionFromRoot);
  assert.equal(sessionFromRoot.audioPath, "/repo/astro/recordings/session.wav");
  assert.equal(sessionFromRoot.outDir, "/repo/astro/.bf-transcripts/session");
  assert.equal(
    resolveContextRoot("/repo/astro", "src/content/docs", configuredDocsRoot),
    "/repo/astro/src/content/docs",
  );
});
