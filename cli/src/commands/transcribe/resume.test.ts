import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  canReuseAudioChunks,
  canReuseDependentAudio,
  canReusePreparedAudio,
  chunkPathForIndex,
  manifestCompatibilityIssues,
  readManifest,
  shouldOverwritePreparedAudio,
  shouldOverwritePreparedChannels,
} from "./resume.js";
import type { Manifest } from "./types.js";

function manifest(): Manifest {
  return {
    version: 2,
    source: "/tmp/source.flac",
    sourceFingerprint: { sizeBytes: 123, mtimeMs: 456 },
    sourceProbe: {
      durationSeconds: 20,
      channels: 2,
      sampleRate: 16000,
      channelLayout: "stereo",
    },
    normalizedStereo: "/tmp/normalized/session.flac",
    preparedChannels: [
      { id: "left", index: 0, path: "/tmp/normalized/channels/left.flac" },
      { id: "right", index: 1, path: "/tmp/normalized/channels/right.flac" },
    ],
    audioSettings: { denoise: false, voiceBoost: false, sampleRate: 16000 },
    chunkSettings: {
      chunkSeconds: 10,
      boundarySearchSeconds: 10,
      boundaryMaxSearchSeconds: 30,
      overlapSeconds: 5,
      keepSilence: true,
      silencePaddingSeconds: 0.5,
      minimumSpeechSeconds: 0.25,
    },
    durationSeconds: 20,
    silences: [],
    chunks: [
      { index: 0, start: 0, end: 10, overlapStart: 0, overlapEnd: 15, endReason: "exact-target" },
      { index: 1, start: 10, end: 20, overlapStart: 5, overlapEnd: 20, endReason: "duration-end" },
    ],
  };
}

test("does not reuse prepared audio when resuming without a manifest", () => {
  assert.equal(canReusePreparedAudio(true, undefined), false);
  assert.equal(canReusePreparedAudio(true, manifest()), true);
  assert.equal(canReusePreparedAudio(false, manifest()), false);
});

test("reuses dependent audio only when the resumable normalized master exists", () => {
  const current = manifest();
  assert.equal(canReuseDependentAudio(true, current, true), true);
  assert.equal(canReuseDependentAudio(true, current, false), false);
  assert.equal(canReuseDependentAudio(true, undefined, true), false);
});

test("overwrites prepared audio only for force or a resume rebuild", () => {
  assert.equal(shouldOverwritePreparedAudio(false, false, false), false);
  assert.equal(shouldOverwritePreparedAudio(true, false, false), true);
  assert.equal(shouldOverwritePreparedAudio(false, true, true), false);
  assert.equal(shouldOverwritePreparedAudio(false, true, false), true);
});

test("repairs only partial derivative sets implicitly during valid resume", () => {
  const cases = [
    ["ordinary complete", false, false, false, true, false],
    ["ordinary partial", false, false, false, false, false],
    ["explicit force", true, false, false, true, true],
    ["resume rebuilt master", true, true, false, false, true],
    ["resume reused complete", false, true, true, true, false],
    ["resume reused partial", false, true, true, false, true],
  ] as const;
  for (const [label, overwritePreparedAudio, shouldResume, reusedNormalizedAudio, allExist, expected] of cases) {
    assert.equal(
      shouldOverwritePreparedChannels(overwritePreparedAudio, shouldResume, reusedNormalizedAudio, allExist),
      expected,
      label,
    );
  }
});

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

test("rejects incomplete v2 manifests with a rebuild instruction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-resume-test-"));
  const path = join(dir, "manifest.json");
  try {
    await writeFile(path, JSON.stringify({ version: 2, source: "/tmp/source.flac" }));
    await assert.rejects(readManifest(path), /rebuild with --force/);
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
  }
});

test("rejects malformed prepared paths, channel layouts, and chunk reasons", async () => {
  const cases = [
    ["prepared channel path", (value: Manifest) => { value.preparedChannels[0]!.path = 42 as unknown as string; }],
    ["channel layout", (value: Manifest) => { value.sourceProbe.channelLayout = 42 as unknown as string; }],
    ["chunk end reason", (value: Manifest) => { value.chunks[0]!.endReason = "unknown" as never; }],
  ] as const;
  for (const [label, mutate] of cases) {
    const dir = await mkdtemp(join(tmpdir(), "bf-resume-invalid-"));
    try {
      const path = join(dir, "manifest.json");
      const value = manifest();
      mutate(value);
      await writeFile(path, JSON.stringify(value));
      await assert.rejects(readManifest(path), /invalid|missing/, label);
    } finally {
      await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
    }
  }
});

test("rejects representative malformed manifest settings and chunk bounds", async () => {
  const cases = [
    ["source sample rate", (value: Manifest) => { value.sourceProbe.sampleRate = 0; }],
    ["audio sample rate", (value: Manifest) => { value.audioSettings.sampleRate = 1.5; }],
    ["chunk seconds", (value: Manifest) => { value.chunkSettings.chunkSeconds = Number.NaN; }],
    ["boundary ordering", (value: Manifest) => { value.chunkSettings.boundaryMaxSearchSeconds = 1; }],
    ["chunk overlap before start", (value: Manifest) => { value.chunks[0]!.overlapStart = 1; }],
    ["chunk overlap after duration", (value: Manifest) => { value.chunks[1]!.overlapEnd = 21; }],
  ] as const;
  for (const [label, mutate] of cases) {
    const dir = await mkdtemp(join(tmpdir(), "bf-resume-invalid-range-"));
    try {
      const path = join(dir, "manifest.json");
      const value = manifest();
      mutate(value);
      await writeFile(path, JSON.stringify(value));
      await assert.rejects(readManifest(path), /invalid|missing/, label);
    } finally {
      await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
    }
  }
});

test("reports changed fingerprints and chunk settings as incompatible", () => {
  const current = manifest();
  const issues = manifestCompatibilityIssues(current, {
    source: current.source,
    sourceFingerprint: { ...current.sourceFingerprint, sizeBytes: 999 },
    sourceProbe: current.sourceProbe,
    normalizedStereo: current.normalizedStereo,
    preparedChannels: current.preparedChannels,
    audioSettings: current.audioSettings,
    chunkSettings: { ...current.chunkSettings, chunkSeconds: 15 },
  });
  assert.deepEqual(issues, ["source fingerprint changed", "chunk settings changed"]);
});

