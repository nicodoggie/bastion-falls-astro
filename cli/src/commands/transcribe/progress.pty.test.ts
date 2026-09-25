import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const cliRoot = process.cwd();
const commandAvailable = (command: string): boolean =>
  spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" })
    .status === 0;
const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;
const stripAnsi = (value: string): string =>
  value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "");

test("real short preparation under a PTY keeps one display line and no child chatter", async (t) => {
  if (!commandAvailable("ffmpeg") || !commandAvailable("script")) {
    t.skip("ffmpeg and util-linux script are required for the PTY proof");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "transcription-progress-pty-"));
  const harness = join(root, "harness.mts");
  await writeFile(
    harness,
    `import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { normalizeToFlac } from ${JSON.stringify(join(cliRoot, "src/commands/transcribe/audio.ts"))};
import { runCommand } from ${JSON.stringify(join(cliRoot, "src/commands/transcribe/process.ts"))};
import { TranscriptionProgressReporter } from ${JSON.stringify(join(cliRoot, "src/commands/transcribe/progress.ts"))};

const root = await mkdtemp(join(tmpdir(), "transcription-prep-child-"));
try {
  const input = join(root, "input.wav");
  const output = join(root, "normalized.flac");
  await runCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "0.25", "-c:a", "pcm_s16le", input]);
  const reporter = new TranscriptionProgressReporter({
    output: process.stdout,
    errorOutput: process.stderr,
    isTTY: Boolean(process.stdout.isTTY),
    terminalWidth: 44,
    now: () => Date.now(),
  });
  await reporter.start();
  await reporter.operation({
    stage: "normalization",
    operation: "Prepare normalized audio",
    task: () => normalizeToFlac(
      input,
      output,
      true,
      {},
      { sink: reporter.sink, totalSeconds: 0.25, render: reporter.mediaReporter("Normalize audio", 0.25, "normalization").render },
      1,
    ),
  });
  await reporter.close();
} finally {
  await rm(root, { recursive: true, force: true });
}
`,
    "utf8",
  );

  try {
    const command = [
      shellQuote(process.execPath),
      "--import",
      shellQuote("tsx"),
      shellQuote(harness),
    ].join(" ");
    const result = spawnSync("script", ["-qefc", command, "/dev/null"], {
      cwd: cliRoot,
      encoding: "utf8",
      maxBuffer: 1_000_000,
    });
    const transcript = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, transcript);
    const beforeFinalNewline = transcript.replace(/\n$/, "");
    assert.doesNotMatch(beforeFinalNewline, /\n/u);
    assert.doesNotMatch(
      transcript,
      /ffmpeg|Normalize audio|heartbeat|chunk|pass|diagnostics/u,
    );
    const displayLines = [...transcript.matchAll(/Stage [^\r\n]*/gu)].map(
      (match) => stripAnsi(match[0] ?? ""),
    );
    assert.ok(displayLines.length > 0, transcript);
    assert.ok(
      displayLines.every((line) => line.length <= 43),
      displayLines.join("\n"),
    );
    assert.match(transcript, /Stage 1\/6: Normaliz/u);
    assert.match(transcript, /\[00:00:/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fake inference under a PTY keeps counts and both clocks advancing", async (t) => {
  if (!commandAvailable("script")) {
    t.skip("util-linux script is required for the PTY proof");
    return;
  }
  const root = await mkdtemp(
    join(tmpdir(), "transcription-progress-count-pty-"),
  );
  const harness = join(root, "harness.mts");
  await writeFile(
    harness,
    `import { TranscriptionProgressReporter } from ${JSON.stringify(join(cliRoot, "src/commands/transcribe/progress.ts"))};
const reporter = new TranscriptionProgressReporter({
  output: process.stdout,
  errorOutput: process.stderr,
  isTTY: Boolean(process.stdout.isTTY),
  terminalWidth: 60,
});
await reporter.operation({
  stage: "transcription",
  operation: "fake inference",
  workUnit: { label: "left", index: 7, total: 43 },
  task: async () => new Promise((resolve) => setTimeout(resolve, 2200)),
});
await reporter.close();
`,
    "utf8",
  );
  try {
    const command = [
      shellQuote(process.execPath),
      "--import",
      shellQuote("tsx"),
      shellQuote(harness),
    ].join(" ");
    const result = spawnSync("script", ["-qefc", command, "/dev/null"], {
      cwd: cliRoot,
      encoding: "utf8",
      maxBuffer: 1_000_000,
    });
    const transcript = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, transcript);
    assert.doesNotMatch(transcript.replace(/\n$/, ""), /\n/u);
    const matches = [
      ...transcript.matchAll(
        /Stage 3\/6: Transcribing · left 8\/43 \[00:00:(\d{2})\]\[00:00:(\d{2})\]/gu,
      ),
    ];
    assert.ok(matches.length >= 3, transcript);
    assert.ok(
      matches.some((match) => Number(match[1]) >= 2 && Number(match[2]) >= 2),
      transcript,
    );
    const displayLines = [...transcript.matchAll(/Stage [^\r\n]*/gu)].map(
      (match) => stripAnsi(match[0] ?? ""),
    );
    assert.ok(
      displayLines.every((line) => line.length <= 59),
      displayLines.join("\n"),
    );
    assert.doesNotMatch(transcript, /fake inference|heartbeat|%/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PTY leaves the final completed stage visible", async (t) => {
  if (!commandAvailable("script")) {
    t.skip("util-linux script is required for the PTY proof");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "transcription-progress-history-pty-"));
  const harness = join(root, "harness.mts");
  await writeFile(
    harness,
    `import { TranscriptionProgressReporter } from ${JSON.stringify(join(cliRoot, "src/commands/transcribe/progress.ts"))};
const reporter = new TranscriptionProgressReporter({
  output: process.stdout,
  errorOutput: process.stderr,
  isTTY: Boolean(process.stdout.isTTY),
  terminalWidth: 44,
});
await reporter.event({ stage: "normalization", operation: "Prepare normalized audio", status: "started" });
reporter.completeStage("normalization", "complete");
await reporter.close();
`,
    "utf8",
  );
  try {
    const command = [
      shellQuote(process.execPath),
      "--import",
      shellQuote("tsx"),
      shellQuote(harness),
    ].join(" ");
    const result = spawnSync("script", ["-qefc", command, "/dev/null"], {
      cwd: cliRoot,
      encoding: "utf8",
      maxBuffer: 1_000_000,
    });
    const transcript = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, transcript);
    const plain = stripAnsi(transcript);
    assert.equal((plain.match(/✓ (?:Stage 1\/6|1\/6)/gu) ?? []).length, 1, plain);
    assert.match(plain, /✓ (?:Stage 1\/6: Normalizing audio|1\/6) .*complete \[/u);
    assert.ok(
      plain.lastIndexOf("✓ 1/6") > plain.lastIndexOf("Stage 1/6: Normaliz"),
      plain,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
