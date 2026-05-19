import { formatTimestamp } from "./assembly.js";

export interface ProgressSink {
  write(message: string): void;
}

export interface ProgressReporter {
  label: string;
  totalSeconds: number;
  sink: ProgressSink;
}

export function parseFfmpegProgressSeconds(text: string): number | undefined {
  const microsMatch = /out_time_(?:us|ms)=([0-9]+)/.exec(text);
  if (microsMatch?.[1]) {
    return Number(microsMatch[1]) / 1_000_000;
  }

  const timeMatch = /out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (timeMatch?.[1] && timeMatch[2] && timeMatch[3]) {
    return Number(timeMatch[1]) * 3_600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
  }

  return undefined;
}

export function formatProgress(label: string, seconds: number, totalSeconds: number): string {
  const boundedSeconds = Math.max(0, Math.min(seconds, totalSeconds));
  const percent = totalSeconds > 0 ? (boundedSeconds / totalSeconds) * 100 : 100;
  return `${label}: ${percent.toFixed(1)}% (${formatTimestamp(boundedSeconds)} / ${formatTimestamp(totalSeconds)})`;
}

export function createFfmpegProgressHandler(reporter?: ProgressReporter): (text: string) => void {
  if (!reporter) {
    return () => {};
  }

  let buffer = "";
  let lastRendered = "";
  return (text: string) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const seconds = parseFfmpegProgressSeconds(line);
      if (seconds === undefined) {
        continue;
      }
      if (seconds >= reporter.totalSeconds) {
        continue;
      }
      const rendered = formatProgress(reporter.label, seconds, reporter.totalSeconds);
      if (rendered !== lastRendered) {
        reporter.sink.write(`\r${rendered}`);
        lastRendered = rendered;
      }
    }
  };
}

export function finishProgress(reporter?: ProgressReporter): void {
  if (!reporter) {
    return;
  }
  reporter.sink.write(`\r${formatProgress(reporter.label, reporter.totalSeconds, reporter.totalSeconds)}\n`);
}
