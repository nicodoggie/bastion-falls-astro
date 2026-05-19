import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { canReuseAudioChunks, chunkPathForIndex } from "./resume.js";
import type { Manifest } from "./types.js";

function manifest(): Manifest {
  return {
    source: "/tmp/source.flac",
    normalized: "/tmp/session.flac",
    durationSeconds: 20,
    chunkSeconds: 10,
    boundarySearchSeconds: 10,
    boundaryMaxSearchSeconds: 30,
    overlapSeconds: 5,
    chunks: [
      { index: 0, start: 0, end: 10, overlapStart: 0, overlapEnd: 15, endReason: "exact-target" },
      { index: 1, start: 10, end: 20, overlapStart: 5, overlapEnd: 20, endReason: "duration-end" },
    ],
  };
}

test("builds chunk paths from manifest indexes", () => {
  assert.equal(chunkPathForIndex("/tmp/chunks", 7), "/tmp/chunks/session_007.flac");
});

test("can reuse audio chunks when manifest and all chunk files exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-resume-test-"));
  try {
    const chunksDir = join(dir, "chunks");
    await mkdir(chunksDir);
    await writeFile(chunkPathForIndex(chunksDir, 0), "");
    await writeFile(chunkPathForIndex(chunksDir, 1), "");

    const result = await canReuseAudioChunks({
      manifest: manifest(),
      chunksDir,
    });

    assert.deepEqual(result, {
      reusable: true,
      chunkPaths: [chunkPathForIndex(chunksDir, 0), chunkPathForIndex(chunksDir, 1)],
      missingIndexes: [],
    });
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
  }
});

test("cannot reuse audio chunks when any chunk file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-resume-test-"));
  try {
    const chunksDir = join(dir, "chunks");
    await mkdir(chunksDir);
    await writeFile(chunkPathForIndex(chunksDir, 0), "");

    const result = await canReuseAudioChunks({
      manifest: manifest(),
      chunksDir,
    });

    assert.deepEqual(result, {
      reusable: false,
      chunkPaths: [chunkPathForIndex(chunksDir, 0), chunkPathForIndex(chunksDir, 1)],
      missingIndexes: [1],
    });
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
  }
});

