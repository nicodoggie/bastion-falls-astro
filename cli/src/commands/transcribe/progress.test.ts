import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createFfmpegProgressHandler,
  displayWidth,
  finishProgress,
  formatInteractiveProgress,
  formatStageCompletion,
  formatProgress,
  parseLogLevel,
  resolveLogLevel,
  TranscriptionProgressReporter,
} from "./progress.js";

const capture = () => {
  const values: string[] = [];
  return {
    values,
    stream: {
      write: (value: string) => {
        values.push(value);
        return true;
      },
    },
  };
};

test("formats stage history with frozen clocks, status labels, and display-width-safe color", () => {
  const completion = {
    stage: "reconciliation" as const,
    stageIndex: 5,
    stageTotal: 6,
    status: "complete" as const,
    stageElapsedMs: 12_000,
    elapsedMs: 34_000,
  };
  const plain = formatStageCompletion(completion, {
    description: "Reconciling",
    terminalWidth: 60,
    color: false,
  });
  const colored = formatStageCompletion(completion, {
    description: "Reconciling",
    terminalWidth: 60,
    color: true,
  });
  assert.match(plain, /✓ Stage 5\/6: .* complete \[00:00:12\]\[00:00:34\]/u);
  assert.match(colored, /\u001b\[32m✓\u001b\[0m/u);
  assert.equal(displayWidth(colored), displayWidth(plain));
  const narrow = formatStageCompletion(completion, {
    description: "Reconciling transcript with a deliberately long label",
    terminalWidth: 40,
    color: true,
  });
  assert.ok(displayWidth(narrow) <= 40, narrow);
});

test("keeps exactly one permanent line per terminal stage and leaves the final line visible", async () => {
  const output = capture();
  let now = 1_000;
  const reporter = new TranscriptionProgressReporter({
    output: output.stream,
    isTTY: true,
    color: false,
    terminalWidth: 80,
    now: () => now,
  });
  await reporter.event({
    stage: "normalization",
    operation: "prepare",
    status: "started",
  });
  now = 3_500;
  reporter.completeStage("normalization", "complete");
  now = 4_000;
  reporter.completeStage("normalization", "reused");
  reporter.completeStage("audio-chunking", "skipped");
  reporter.completeStage("notes", "failed", { error: "notes unavailable" });
  reporter.finish("workflow stopped");
  await reporter.close();

  const rendered = output.values.join("");
  assert.equal((rendered.match(/✓ Stage 1\/6/gu) ?? []).length, 1, rendered);
  assert.equal((rendered.match(/– Stage 2\/6/gu) ?? []).length, 1, rendered);
  assert.equal((rendered.match(/× Stage 6\/6/gu) ?? []).length, 1, rendered);
  assert.match(rendered, /✓ Stage 1\/6: Normalizing audio complete \[00:00:02\]\[00:00:02\]/u);
  assert.match(rendered, /× Stage 6\/6: Generating notes failed/u);
  assert.doesNotMatch(rendered, /reused.*Stage 1\/6|Stage 1\/6.*reused/u);
});

test("formats media progress as bounded elapsed media time without percentages", () => {
  assert.equal(
    formatProgress("normalize", 15, 10),
    "normalize: 00:00:10 / 00:00:10",
  );
  assert.doesNotMatch(formatProgress("normalize", 5, 10), /%/u);
});

test("routes FFmpeg progress through one compact in-place stage line", async () => {
  const output = capture();
  const reporter = new TranscriptionProgressReporter({
    output: output.stream,
    isTTY: true,
    now: () => 0,
  });
  const media = reporter.mediaReporter("Normalize audio", 2, "normalization");
  createFfmpegProgressHandler(media)(
    "out_time_us=1000000\nprogress=continue\n",
  );
  finishProgress(media);
  await reporter.close();
  const rendered = output.values.join("");
  assert.match(
    rendered,
    /Stage 1\/6: Normalizing audio \[00:00:00\]\[00:00:00\]/u,
  );
  assert.match(rendered, /\x1b\[2K/u);
  assert.doesNotMatch(rendered, /Normalize audio|heartbeat|%/u);
});

test("keeps the stage clock through same-stage work and resets it on transition", async () => {
  const output = capture();
  let now = 0;
  const reporter = new TranscriptionProgressReporter({
    output: output.stream,
    isTTY: true,
    terminalWidth: 80,
    now: () => now,
  });
  await reporter.event({
    stage: "normalization",
    operation: "Prepare normalized audio",
    status: "started",
  });
  now += 5_000;
  await reporter.event({
    stage: "normalization",
    operation: "short operation must not replace the stage description",
    status: "heartbeat",
  });
  now += 2_000;
  await reporter.event({
    stage: "transcription",
    operation: "ASR",
    status: "started",
  });
  await reporter.close();

  const rendered = output.values.join("");
  assert.match(
    rendered,
    /Stage 1\/6: Normalizing audio \[00:00:05\]\[00:00:05\]/u,
  );
  assert.match(
    rendered,
    /Stage 3\/6: Transcribing \[00:00:00\]\[00:00:07\]/u,
  );
  assert.doesNotMatch(rendered, /short operation/u);
});

test("repaints a quiet interactive operation once per second without progress events", async () => {
  const output = capture();
  const reporter = new TranscriptionProgressReporter({
    output: output.stream,
    isTTY: true,
    terminalWidth: 80,
  });
  await reporter.operation({
    stage: "transcription",
    operation: "quiet simulated ASR",
    workUnit: { label: "left", index: 7, total: 43 },
    task: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_200));
    },
  });
  await reporter.close();

  const rendered = output.values.join("");
  const lines = [
    ...rendered.matchAll(
      /Stage 3\/6: Transcribing · left 8\/43 \[00:00:(\d{2})\]\[00:00:(\d{2})\]/gu,
    ),
  ];
  assert.ok(lines.length >= 3, rendered);
  assert.ok(
    lines.some((match) => Number(match[1]) >= 2 && Number(match[2]) >= 2),
    rendered,
  );
  assert.doesNotMatch(rendered, /heartbeat|quiet simulated ASR/u);
});

test("fits and sanitizes shrinking descriptions while retaining elapsed clocks", () => {
  const long = formatInteractiveProgress({
    stageIndex: 2,
    stageTotal: 6,
    description: "A very long\n\x1b[31m operation description",
    stageElapsedMs: 1_000,
    elapsedMs: 65_000,
    terminalWidth: 40,
  });
  const short = formatInteractiveProgress({
    stageIndex: 2,
    stageTotal: 6,
    description: "ASR",
    stageElapsedMs: 2_000,
    elapsedMs: 66_000,
    terminalWidth: 40,
  });
  assert.ok(long.length <= 39);
  assert.ok(short.length <= 39);
  assert.match(long, /\[00:00:01\]\[00:01:05\]$/u);
  assert.match(short, /Stage 2\/6: ASR \[00:00:02\]\[00:01:06\]$/u);
  assert.doesNotMatch(long, /[\r\n\x1b]/u);
});

test("renders truthful inline work-unit counts and keeps them ahead of clocks when narrow", () => {
  const reconciliation = formatInteractiveProgress({
    stageIndex: 5,
    stageTotal: 6,
    description: "Reconciling",
    workUnit: { label: "chunk", index: 7, total: 43 },
    stageElapsedMs: 1_000,
    elapsedMs: 2_000,
    terminalWidth: 80,
  });
  assert.equal(
    reconciliation,
    "Stage 5/6: Reconciling · chunk 8/43 [00:00:01][00:00:02]",
  );
  const asr = formatInteractiveProgress({
    stageIndex: 3,
    stageTotal: 6,
    description: "Transcribing",
    workUnit: { label: "left", index: 7, total: 43 },
    stageElapsedMs: 1_000,
    elapsedMs: 2_000,
    terminalWidth: 80,
  });
  assert.match(asr, /^Stage 3\/6: Transcribing · left 8\/43 /u);
  const narrow = formatInteractiveProgress({
    stageIndex: 5,
    stageTotal: 6,
    description: "A description that must yield first",
    workUnit: { label: "chunk", index: 7, total: 43 },
    stageElapsedMs: 1_000,
    elapsedMs: 2_000,
    terminalWidth: 44,
  });
  assert.ok(narrow.length <= 43, narrow);
  assert.match(narrow, /chunk 8\/43/u);
  assert.match(narrow, /\[00:00:01\]\[00:00:02\]$/u);
  assert.doesNotMatch(narrow, /description/u);
});

test("uses compact plain-text fallback for non-TTY without dumping routine detail", async () => {
  const output = capture();
  const reporter = new TranscriptionProgressReporter({
    output: output.stream,
    isTTY: false,
    now: () => 0,
  });
  await reporter.event({
    stage: "notes",
    operation: "Generate session summary",
    status: "started",
    diagnosticPath: "/private/diagnostics",
  });
  reporter.info("routine path detail");
  await reporter.close();
  assert.match(output.values.join(""), /Stage 6\/6: Generating notes/u);
  assert.doesNotMatch(
    output.values.join(""),
    /routine path detail|diagnostics/u,
  );
});

test("writes filtered append-only detail and keeps metadata out of prompt bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "transcription-progress-"));
  const output = capture();
  let now = 1000;
  const logPath = join(root, "progress.jsonl");
  const reporter = new TranscriptionProgressReporter({
    output: output.stream,
    logPath,
    logLevel: "debug",
    verbose: true,
    isTTY: false,
    now: () => now,
    heartbeatMs: 5,
  });
  try {
    await reporter.start();
    await reporter.operation({
      stage: "reconciliation",
      operation: "Reconcile transcript",
      diagnosticPath: join(root, "diagnostics"),
      task: async () => {
        now += 1500;
      },
    });
    const lines = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(lines.at(-1)?.["status"], "completed");
    assert.equal(lines.at(-1)?.["stageIndex"], 5);
    assert.equal(lines.at(-1)?.["stageTotal"], 6);
    assert.equal(lines.at(-1)?.["elapsedMs"], 1500);
    assert.equal(lines.at(-1)?.["stageElapsedMs"], 1500);
    assert.equal(lines.at(-1)?.["severity"], "info");
    assert.match(String(output.values.at(-1)), /elapsed 1\.5s/u);
    assert.match(String(output.values.at(-1)), /stage elapsed 00:00:01/u);
    assert.doesNotMatch(
      await readFile(logPath, "utf8"),
      /prompt|transcript body|Andrew answers/u,
    );
  } finally {
    await reporter.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("applies log-level precedence and severity filtering independently of the UI", async () => {
  assert.equal(resolveLogLevel({ configured: "warn" }), "warn");
  assert.equal(resolveLogLevel({ configured: "warn", verbose: true }), "debug");
  assert.equal(
    resolveLogLevel({ flag: "error", verbose: true, configured: "debug" }),
    "error",
  );
  assert.equal(parseLogLevel("warning"), "warn");
  assert.throws(
    () => parseLogLevel("trace"),
    /Expected debug, info, warn, or error/u,
  );

  const root = await mkdtemp(join(tmpdir(), "transcription-progress-levels-"));
  try {
    const output = capture();
    const errors = capture();
    const reporter = new TranscriptionProgressReporter({
      output: output.stream,
      errorOutput: errors.stream,
      logPath: join(root, "progress.jsonl"),
      logLevel: "warn",
      verbose: true,
      isTTY: false,
    });
    await reporter.event({
      stage: "notes",
      operation: "info lifecycle",
      status: "started",
    });
    reporter.info("filtered info");
    reporter.debug("filtered debug");
    reporter.warn("visible warning");
    await reporter.close();
    assert.doesNotMatch(output.values.join(""), /info lifecycle|filtered/u);
    assert.match(errors.values.join(""), /Warning: visible warning/u);
    const lines = (await readFile(join(root, "progress.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const warning = lines.find(
      (line) => line["operation"] === "visible warning",
    );
    assert.equal(warning?.["severity"], "warn");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports failure and cleans heartbeat timers after clearing the display", async () => {
  const output = capture();
  const errors = capture();
  const reporter = new TranscriptionProgressReporter({
    output: output.stream,
    errorOutput: errors.stream,
    isTTY: true,
    heartbeatMs: 1,
  });
  await assert.rejects(
    () =>
      reporter.operation({
        stage: "notes",
        operation: "Generate session summary",
        task: async () => {
          throw new Error("diagnostic path only");
        },
      }),
    /diagnostic path only/u,
  );
  assert.match(errors.values.join(""), /Error: diagnostic path only/u);
  assert.match(output.values.join(""), /\x1b\[2K/u);
  const afterFailure = output.values.join("");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(output.values.join(""), afterFailure);
  await reporter.close();
});
