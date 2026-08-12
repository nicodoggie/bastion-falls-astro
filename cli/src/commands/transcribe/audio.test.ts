import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildAudioFilter,
  channelId,
  deriveMonoChannels,
  normalizeToFlac,
  measureAudioWindowEnergy,
  normalizeRelativeEnergies,
  parseAudioProbe,
  probeAudio,
} from "./audio.js";

test("measures an injected speech window and normalizes finite channel powers", async () => {
  const calls: string[][] = [];
  const energy = await measureAudioWindowEnergy("/tmp/left.flac", 1.25, 0.75, async (command, args, options) => {
    calls.push([command, ...args, `timeout=${options?.timeoutMs}`]);
    return { stdout: "", stderr: "[Parsed_volumedetect] mean_volume: -3.0103 dB" };
  });
  assert.ok(energy !== undefined);
  assert.equal(calls[0]?.includes("-ss") && calls[0]?.includes("1.25"), true);
  assert.equal(calls[0]?.includes("timeout=30000"), true);
  assert.deepEqual(normalizeRelativeEnergies([energy, 0]), [1, 0]);
  assert.equal(await measureAudioWindowEnergy("/tmp/silence.flac", 0, 1, async () => ({ stdout: "", stderr: "mean_volume: -Infinity dB" })), undefined);
});

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("falls back to format duration when the audio stream duration is N/A", () => {
  const result = parseAudioProbe(
    JSON.stringify({
      streams: [{ codec_type: "audio", duration: "N/A", channels: 1, sample_rate: "16000" }],
      format: { duration: "12.5" },
    }),
    "/tmp/source.flac",
  );
  assert.equal(result.durationSeconds, 12.5);
});

test("reports malformed ffprobe JSON with the audio path and original cause", () => {
  assert.throws(
    () => parseAudioProbe("{not-json", "/tmp/broken.flac"),
    (error: unknown) => {
      assert.equal((error as Error).message, "Could not parse ffprobe metadata for /tmp/broken.flac");
      assert.equal((error as Error).cause instanceof SyntaxError, true);
      return true;
    },
  );
});

test("builds the default speech normalization filter", () => {
  assert.equal(
    buildAudioFilter({}),
    "highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11",
  );
});

test("runs denoise and voice boost before loudness normalization", () => {
  assert.equal(
    buildAudioFilter({ denoise: true, voiceBoost: true }),
    [
      "afftdn",
      "highpass=f=80",
      "lowpass=f=8000",
      "equalizer=f=3000:t=q:w=1:g=3",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
    ].join(","),
  );
});

test("names stereo and multichannel derivatives through one helper", () => {
  assert.deepEqual([0, 1].map((index) => channelId(index, 2)), ["left", "right"]);
  assert.deepEqual(
    [0, 1, 2].map((index) => channelId(index, 3)),
    ["channel-0", "channel-1", "channel-2"],
  );
});

test("prepares a stereo master and louder-preserving mono channel derivatives", {
  skip: !ffmpegAvailable,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-stereo-audio-"));
  try {
    const source = join(dir, "source.flac");
    const normalized = join(dir, "normalized", "session.flac");
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=1",
        "-filter_complex",
        "[0:a]volume=0.1[l];[1:a]volume=0.8[r];[l][r]amerge=inputs=2[out]",
        "-map",
        "[out]",
        "-ar",
        "16000",
        "-c:a",
        "flac",
        source,
      ],
      { stdio: "ignore" },
    );
    await normalizeToFlac(source, normalized, true, {});
    const master = await probeAudio(normalized);
    assert.equal(master.channels, 2);
    const channels = await deriveMonoChannels({
      stereoPath: normalized,
      channelsDir: join(dir, "channels"),
      channelCount: master.channels,
      force: true,
    });
    assert.deepEqual(
      channels.map(({ id, index }) => ({ id, index })),
      [
        { id: "left", index: 0 },
        { id: "right", index: 1 },
      ],
    );
    const [left, right] = await Promise.all(
      channels.map(({ path }) => probeAudio(path)),
    );
    assert.equal(left!.channels, 1);
    assert.equal(right!.channels, 1);
    assert.ok(Math.abs(left!.durationSeconds - right!.durationSeconds) < 0.05);
    assert.ok(Math.abs(left!.durationSeconds - master.durationSeconds) < 0.05);
    assert.ok(Math.abs(right!.durationSeconds - master.durationSeconds) < 0.05);

    const measure = (path: string): number => {
      const result = spawnSync(
        "ffmpeg",
        ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return Number(
        `${result.stdout}${result.stderr}`.match(
          /mean_volume:\s*(-?[\d.]+) dB/,
        )?.[1],
      );
    };
    assert.ok(measure(channels[1]!.path) > measure(channels[0]!.path));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
