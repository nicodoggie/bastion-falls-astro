import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { formatTimestamp } from "./assembly.js";

export interface ProgressSink {
  write(message: string): void;
}

export interface ProgressReporter {
  label: string;
  totalSeconds: number;
  sink: ProgressSink;
  render?: (seconds: number) => void;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function parseLogLevel(value: string): LogLevel {
  const normalized = value.trim().toLowerCase();
  if (normalized === "warning") return "warn";
  if ((LOG_LEVELS as readonly string[]).includes(normalized))
    return normalized as LogLevel;
  throw new Error(
    `Unsupported transcription log level: ${value}. Expected debug, info, warn, or error (warning is accepted as warn).`,
  );
}

export function resolveLogLevel(options: {
  flag?: string;
  verbose?: boolean;
  configured?: unknown;
}): LogLevel {
  if (options.flag !== undefined) return parseLogLevel(options.flag);
  if (options.verbose) return "debug";
  if (options.configured === undefined) return "info";
  if (typeof options.configured !== "string") {
    throw new Error(
      "Invalid transcribe.progress.logLevel; expected debug, info, warn, or error.",
    );
  }
  return parseLogLevel(options.configured);
}

export function parseFfmpegProgressSeconds(text: string): number | undefined {
  const microsMatch = /out_time_(?:us|ms)=([0-9]+)/.exec(text);
  if (microsMatch?.[1]) return Number(microsMatch[1]) / 1_000_000;
  const timeMatch = /out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (timeMatch?.[1] && timeMatch[2] && timeMatch[3])
    return (
      Number(timeMatch[1]) * 3_600 +
      Number(timeMatch[2]) * 60 +
      Number(timeMatch[3])
    );
  return undefined;
}

export function formatProgress(
  label: string,
  seconds: number,
  totalSeconds: number,
): string {
  const boundedSeconds = Math.max(0, Math.min(seconds, totalSeconds));
  return `${label}: ${formatTimestamp(boundedSeconds)} / ${formatTimestamp(totalSeconds)}`;
}

export function createFfmpegProgressHandler(
  reporter?: ProgressReporter,
): (text: string) => void {
  if (!reporter) return () => {};
  let buffer = "";
  let lastRendered = "";
  return (text: string) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const seconds = parseFfmpegProgressSeconds(line);
      if (seconds === undefined || seconds >= reporter.totalSeconds) continue;
      const rendered = formatProgress(
        reporter.label,
        seconds,
        reporter.totalSeconds,
      );
      if (rendered !== lastRendered) {
        if (reporter.render) reporter.render(seconds);
        else reporter.sink.write(`\r${rendered}`);
        lastRendered = rendered;
      }
    }
  };
}

export function finishProgress(reporter?: ProgressReporter): void {
  if (!reporter) return;
  if (reporter.render) {
    reporter.render(reporter.totalSeconds);
    return;
  }
  reporter.sink.write(
    `\r\x1b[2K${formatProgress(reporter.label, reporter.totalSeconds, reporter.totalSeconds)}\n`,
  );
}

export type ProgressStage =
  | "normalization"
  | "audio-chunking"
  | "transcription"
  | "raw-assembly"
  | "reconciliation"
  | "notes";

export type ProgressStageCompletionStatus =
  | "complete"
  | "reused"
  | "skipped"
  | "failed";

export interface ProgressStageCompletion {
  stage: ProgressStage;
  stageIndex: number;
  stageTotal: number;
  status: ProgressStageCompletionStatus;
  stageElapsedMs: number;
  elapsedMs: number;
  error?: string;
}

/** A planned unit of work shown inline without estimating completion. */
export interface ProgressWorkUnit {
  label: string;
  /** Zero-based position in the stage plan. */
  index: number;
  total: number;
}

export type ProgressWorkUnitStatus =
  | "started"
  | "reused"
  | "retry"
  | "completed";

export interface ProgressWorkUnitEvent {
  operation: string;
  workUnit: ProgressWorkUnit;
  status: ProgressWorkUnitStatus;
  attempt?: number;
  maxAttempts?: number;
}

export type ProgressWorkUnitHook = (
  event: ProgressWorkUnitEvent,
) => void | Promise<void>;

const STAGES: readonly ProgressStage[] = [
  "normalization",
  "audio-chunking",
  "transcription",
  "raw-assembly",
  "reconciliation",
  "notes",
];

const STAGE_DESCRIPTIONS: Record<ProgressStage, string> = {
  normalization: "Normalizing audio",
  "audio-chunking": "Preparing audio chunks",
  transcription: "Transcribing",
  "raw-assembly": "Assembling transcript",
  reconciliation: "Reconciling",
  notes: "Generating notes",
};

export interface ProgressEvent {
  timestamp: string;
  elapsedMs: number;
  stageElapsedMs: number;
  stage: ProgressStage;
  stageIndex: number;
  stageTotal: number;
  operation: string;
  status:
    | "started"
    | "heartbeat"
    | "reused"
    | "retry"
    | "completed"
    | "failed";
  severity: LogLevel;
  chunkIndex?: number;
  chunkCount?: number;
  pass?: string;
  workUnit?: ProgressWorkUnit;
  attempt?: number;
  maxAttempts?: number;
  diagnosticPath?: string;
  error?: string;
}

type ProgressEventInput = Omit<
  ProgressEvent,
  | "timestamp"
  | "elapsedMs"
  | "stageElapsedMs"
  | "stageIndex"
  | "stageTotal"
  | "severity"
>;

export interface ProgressReporterOptions {
  output: Pick<NodeJS.WritableStream, "write">;
  errorOutput?: Pick<NodeJS.WritableStream, "write">;
  logPath?: string;
  enabled?: boolean;
  verbose?: boolean;
  logLevel?: LogLevel;
  heartbeatMs?: number;
  now?: () => number;
  isTTY?: boolean;
  terminalWidth?: number;
  color?: boolean;
}

function severityForStatus(status: ProgressEvent["status"]): LogLevel {
  if (status === "heartbeat") return "debug";
  if (status === "retry") return "warn";
  if (status === "failed") return "error";
  return "info";
}

function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[threshold];
}

export function sanitizeProgressText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const ANSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/gu;

function stripAnsi(value: string): string {
  return value.replace(ANSI_SEQUENCE, "");
}

function codePointWidth(codePoint: number): number {
  if (
    codePoint === 0 ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  )
    return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2329 && codePoint <= 0x232a) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  )
    return 2;
  return 1;
}

export function displayWidth(value: string): number {
  let width = 0;
  for (const character of stripAnsi(value))
    width += codePointWidth(character.codePointAt(0) ?? 0);
  return width;
}

function truncateText(value: string, maxColumns: number): string {
  if (maxColumns <= 0) return "";
  if (displayWidth(value) <= maxColumns) return value;
  if (maxColumns <= 3) {
    let result = "";
    for (const character of stripAnsi(value)) {
      if (displayWidth(result + character) > maxColumns) break;
      result += character;
    }
    return result;
  }
  const target = maxColumns - 3;
  let result = "";
  for (const character of stripAnsi(value)) {
    if (displayWidth(result + character) > target) break;
    result += character;
  }
  return `${result}...`;
}

function colorize(value: string, code: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function stageMarker(
  status: ProgressStageCompletionStatus,
  color: boolean,
): string {
  const marker =
    status === "complete"
      ? "✓"
      : status === "reused"
        ? "↻"
        : status === "skipped"
          ? "–"
          : "×";
  const code =
    status === "complete"
      ? "32"
      : status === "failed"
        ? "31"
        : status === "reused"
          ? "36"
          : "2";
  return colorize(marker, code, color);
}

export function formatStageCompletion(
  completion: ProgressStageCompletion,
  options: { description: string; terminalWidth?: number; color?: boolean },
): string {
  const width = Math.max(1, options.terminalWidth ?? 80);
  const color = options.color ?? false;
  const prefix = `${stageMarker(completion.status, color)} Stage ${completion.stageIndex}/${completion.stageTotal}: `;
  const suffix = colorize(
    ` [${formatTimestamp(Math.max(0, completion.stageElapsedMs) / 1000)}][${formatTimestamp(Math.max(0, completion.elapsedMs) / 1000)}]`,
    "2",
    color,
  );
  const status = completion.status;
  const description = sanitizeProgressText(options.description) || "Working";
  const error = completion.error
    ? `: ${truncateText(sanitizeProgressText(completion.error), Math.max(1, width - displayWidth(prefix) - displayWidth(suffix) - status.length - 4))}`
    : "";
  const plainPrefix = `${stageMarker(completion.status, false)} Stage ${completion.stageIndex}/${completion.stageTotal}: `;
  const availableDescription =
    width - displayWidth(plainPrefix) - displayWidth(suffix) - status.length - displayWidth(error);
  const fittedDescription = truncateText(description, Math.max(0, availableDescription));
  const descriptionSeparator = fittedDescription ? " " : "";
  const line = `${prefix}${fittedDescription}${descriptionSeparator}${status}${error}${suffix}`;
  if (displayWidth(line) <= width) return line;
  const compactPrefix = `${stageMarker(completion.status, color)} ${completion.stageIndex}/${completion.stageTotal} `;
  const compactLine = `${compactPrefix}${status}${error}${suffix}`;
  if (displayWidth(compactLine) <= width) return compactLine;
  const minimalPrefix = `${completion.stageIndex}/${completion.stageTotal} `;
  const minimalLine = `${minimalPrefix}${status}${error}${suffix}`;
  if (displayWidth(minimalLine) <= width) return minimalLine;
  if (displayWidth(suffix) <= width) {
    const body = truncateText(
      `${minimalPrefix}${status}${error}`,
      width - displayWidth(suffix),
    );
    return `${body}${suffix}`;
  }
  return truncateText(line, width);
}

export function formatInteractiveProgress(options: {
  stageIndex: number;
  stageTotal: number;
  description: string;
  stageElapsedMs: number;
  elapsedMs: number;
  terminalWidth?: number;
  workUnit?: ProgressWorkUnit;
}): string {
  const width = Math.max(1, options.terminalWidth ?? 80) - 1;
  const prefix = `Stage ${options.stageIndex}/${options.stageTotal}: `;
  const suffix = ` [${formatTimestamp(Math.max(0, options.stageElapsedMs) / 1000)}][${formatTimestamp(Math.max(0, options.elapsedMs) / 1000)}]`;
  const description = sanitizeProgressText(options.description) || "Working";
  const unitLabel = sanitizeProgressText(options.workUnit?.label ?? "");
  const unitIndex = options.workUnit?.index;
  const unitTotal = options.workUnit?.total;
  const unit =
    unitLabel &&
    Number.isInteger(unitIndex) &&
    Number.isInteger(unitTotal) &&
    (unitTotal ?? 0) > 0
      ? `${unitLabel} ${Math.max(0, unitIndex ?? 0) + 1}/${unitTotal}`
      : "";
  const unitSuffix = unit ? ` · ${unit}` : "";
  const availableDescription =
    width - displayWidth(prefix) - displayWidth(unitSuffix) - displayWidth(suffix);
  if (availableDescription >= 0) {
    return `${prefix}${truncateText(description, availableDescription)}${unitSuffix}${suffix}`;
  }
  const usefulTail = `${prefix}${unitSuffix}${suffix}`;
  if (displayWidth(usefulTail) <= width) return usefulTail;
  const compactPrefix = prefix.trimEnd();
  const compactTail = `${compactPrefix}${unitSuffix}${suffix}`;
  if (displayWidth(compactTail) <= width) return compactTail;
  const shortPrefix = `Stage ${options.stageIndex}/${options.stageTotal}`;
  const shortTail = `${shortPrefix}${unitSuffix}${suffix}`;
  if (displayWidth(shortTail) <= width) return shortTail;
  const minimalTail = `${options.stageIndex}/${options.stageTotal}${unitSuffix}${suffix}`;
  if (displayWidth(minimalTail) <= width) return minimalTail;
  if (unitSuffix && displayWidth(`${unitSuffix.trimStart()}${suffix}`) <= width)
    return `${unitSuffix.trimStart()}${suffix}`;
  if (displayWidth(suffix) <= width) return suffix;
  return truncateText(usefulTail, width);
}

/** Session-local progress that reports elapsed work, never inferred percentages. */
export class TranscriptionProgressReporter {
  private readonly startedAt: number;
  private readonly stageStartedAt: { value: number } = { value: 0 };
  private currentStage: ProgressStage | undefined;
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private logReady: Promise<void> | undefined;
  private readonly pendingLogs = new Set<Promise<void>>();
  private readonly logLevel: LogLevel;
  private readonly terminalWidth: number;
  private readonly colorEnabled: boolean;
  private readonly completedStages = new Map<ProgressStage, ProgressStageCompletion>();
  private displayedInteractiveLine = false;
  private currentDisplayStage: ProgressStage | undefined;
  private currentWorkUnit: ProgressWorkUnit | undefined;
  private interactiveTimer: ReturnType<typeof setInterval> | undefined;
  private interactiveOperations = 0;
  private closed = false;
  private finished = false;
  private interactiveSuppressed = false;
  private lastReportedError: string | undefined;

  public readonly sink: ProgressSink = { write: () => undefined };

  public constructor(private readonly options: ProgressReporterOptions) {
    this.startedAt = (options.now ?? Date.now)();
    this.logLevel = options.logLevel ?? "info";
    this.terminalWidth = options.terminalWidth ?? 80;
    const terminalAllowsColor = Boolean(
      options.isTTY &&
        !options.verbose &&
        process.env["NO_COLOR"] === undefined &&
        process.env["TERM"] !== "dumb",
    );
    this.colorEnabled = Boolean(options.color ?? terminalAllowsColor) && terminalAllowsColor;
  }

  public async start(): Promise<void> {
    if (this.options.enabled === false || !this.options.logPath) return;
    this.logReady ??= (async () => {
      await mkdir(dirname(this.options.logPath!), { recursive: true });
    })();
    await this.logReady;
  }

  public async event(event: ProgressEventInput): Promise<void> {
    if (this.options.enabled === false || this.closed || this.finished) return;
    const full = this.buildEvent(event);
    this.renderEvent(full);
    if (full.status === "failed") {
      this.reportError(full.error ?? full.operation, false);
    }
    await this.writeEventLog(full);
  }

  public debug(message: string): void {
    this.routeMessage("debug", message);
  }

  public info(message: string): void {
    this.routeMessage("info", message);
  }

  public warn(message: string): void {
    this.routeMessage("warn", message);
  }

  public error(message: string): void {
    this.reportError(message, true);
  }

  /** Records one terminal outcome for a real pipeline stage, never for a work unit. */
  public completeStage(
    stage: ProgressStage,
    status: ProgressStageCompletionStatus,
    details: { error?: string } = {},
  ): void {
    if (
      this.options.enabled === false ||
      this.closed ||
      this.finished ||
      this.completedStages.has(stage)
    )
      return;
    const now = (this.options.now ?? Date.now)();
    if (this.currentStage !== stage) {
      this.currentStage = stage;
      this.stageStartedAt.value = now;
    }
    const completion: ProgressStageCompletion = {
      stage,
      stageIndex: STAGES.indexOf(stage) + 1,
      stageTotal: STAGES.length,
      status,
      stageElapsedMs: Math.max(0, now - this.stageStartedAt.value),
      elapsedMs: Math.max(0, now - this.startedAt),
      ...(details.error
        ? { error: sanitizeProgressText(details.error) }
        : {}),
    };
    this.completedStages.set(stage, completion);
    this.currentWorkUnit = undefined;
    this.renderStageCompletion(completion);
    this.queueStageCompletionLog(completion);
  }

  /** Finish a run without leaving the previous in-place line on screen. */
  public finish(message?: string): void {
    if (this.options.enabled === false || this.finished) return;
    this.finished = true;
    this.stopAllTimers();
    this.clearInteractiveLine();
    this.displayedInteractiveLine = false;
    if (!message) return;
    const clean = sanitizeProgressText(message);
    if (!clean) return;
    if (this.options.verbose) {
      if (shouldLog("info", this.logLevel))
        this.options.output.write(
          `[${new Date().toISOString()}] info: ${clean}\n`,
        );
    } else if (!this.options.isTTY) {
      this.options.output.write(`${clean}\n`);
    } else {
      this.options.output.write("\n");
    }
  }

  /** Adapts FFmpeg's progress stream to this reporter's single output owner. */
  public mediaReporter(
    label: string,
    totalSeconds: number,
    stage: ProgressStage,
  ): ProgressReporter {
    return {
      label,
      totalSeconds,
      sink: this.sink,
      render: (seconds) => {
        const bounded = Math.max(0, Math.min(seconds, totalSeconds));
        const event: ProgressEventInput = {
          stage,
          operation: label,
          status: "heartbeat",
          diagnosticPath: `${formatTimestamp(bounded)} / ${formatTimestamp(totalSeconds)}`,
        };
        const full = this.buildEvent(event);
        this.renderEvent(full);
        this.queueEventLog(full);
      },
    };
  }

  public async operation<T>(options: {
    stage: ProgressStage;
    operation: string;
    chunkIndex?: number;
    chunkCount?: number;
    pass?: string;
    workUnit?: ProgressWorkUnit;
    diagnosticPath?: string;
    reused?: boolean;
    task: () => Promise<T>;
  }): Promise<T> {
    await this.event({
      ...options,
      status: options.reused ? "reused" : "started",
    });
    this.startInteractiveOperation();
    if (options.reused) {
      try {
        return await options.task();
      } finally {
        this.endInteractiveOperation();
      }
    }
    const timer = setInterval(() => {
      void this.event({ ...options, status: "heartbeat" });
    }, this.options.heartbeatMs ?? 30_000);
    this.timers.add(timer);
    try {
      const result = await options.task();
      await this.event({ ...options, status: "completed" });
      return result;
    } catch (error) {
      await this.event({
        ...options,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearInterval(timer);
      this.timers.delete(timer);
      this.endInteractiveOperation();
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.stopAllTimers();
    await Promise.all(this.pendingLogs);
    if (this.options.isTTY && !this.options.verbose) {
      if (this.displayedInteractiveLine) {
        this.clearInteractiveLine();
        this.options.output.write("\n");
      }
    }
  }

  private buildEvent(input: ProgressEventInput): ProgressEvent {
    const now = (this.options.now ?? Date.now)();
    if (this.currentStage !== input.stage) {
      this.currentStage = input.stage;
      this.stageStartedAt.value = now;
    }
    return {
      ...input,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.max(0, now - this.startedAt),
      stageElapsedMs: Math.max(0, now - this.stageStartedAt.value),
      stageIndex: STAGES.indexOf(input.stage) + 1,
      stageTotal: STAGES.length,
      severity: severityForStatus(input.status),
    };
  }

  private renderEvent(event: ProgressEvent): void {
    if (this.closed || this.finished || this.interactiveSuppressed) return;
    if (this.options.verbose) {
      if (shouldLog(event.severity, this.logLevel))
        this.options.output.write(`${this.formatDetailed(event)}\n`);
      return;
    }
    const previousStage = this.currentDisplayStage;
    const displayUnit =
      event.workUnit ??
      (event.stage === previousStage ? this.currentWorkUnit : undefined);
    const compact = formatInteractiveProgress({
      stageIndex: event.stageIndex,
      stageTotal: event.stageTotal,
      description: STAGE_DESCRIPTIONS[event.stage],
      stageElapsedMs: event.stageElapsedMs,
      elapsedMs: event.elapsedMs,
      terminalWidth: this.terminalWidth,
      workUnit: displayUnit,
    });
    this.currentDisplayStage = event.stage;
    this.currentWorkUnit = displayUnit;
    if (!this.options.isTTY) {
      this.options.output.write(`${compact}\n`);
      return;
    }
    this.clearInteractiveLine();
    const active = this.colorEnabled
      ? colorize(compact, "36", true)
      : compact;
    this.options.output.write(`\r${active}`);
    this.displayedInteractiveLine = true;
  }

  private renderStageCompletion(completion: ProgressStageCompletion): void {
    const severity = completion.status === "failed" ? "error" : "info";
    if (this.options.verbose && !shouldLog(severity, this.logLevel)) return;
    const line = formatStageCompletion(completion, {
      description: STAGE_DESCRIPTIONS[completion.stage],
      terminalWidth: this.terminalWidth,
      color: this.colorEnabled,
    });
    if (this.options.isTTY && !this.options.verbose) this.clearInteractiveLine();
    this.options.output.write(`${line}\n`);
    this.displayedInteractiveLine = false;
    this.currentDisplayStage = completion.stage;
  }

  private clearInteractiveLine(): void {
    if (!this.options.isTTY || this.options.verbose) return;
    this.options.output.write("\r\x1b[2K");
  }

  private routeMessage(level: LogLevel, message: string): void {
    if (this.options.enabled === false) return;
    const clean = sanitizeProgressText(message);
    if (!clean) return;
    const event = {
      ...this.buildEvent({
        stage: this.currentStage ?? "normalization",
        operation: clean,
        status: level === "error" ? "failed" : "heartbeat",
        ...(level === "error" ? { error: clean } : {}),
      }),
      severity: level,
    };
    this.queueEventLog(event);
    if (!shouldLog(level, this.logLevel)) return;
    if (level === "warn" || level === "error") {
      this.clearInteractiveLine();
      this.writeError(`${level === "warn" ? "Warning" : "Error"}: ${clean}\n`);
      if (level === "error") this.lastReportedError = clean;
      this.displayedInteractiveLine = false;
      return;
    }
    if (this.options.verbose) {
      this.options.output.write(
        `[${new Date().toISOString()}] ${level}: ${clean}\n`,
      );
    }
  }

  private reportError(message: string, record: boolean): void {
    const clean = sanitizeProgressText(message) || "Transcription failed";
    if (clean === this.lastReportedError) return;
    this.interactiveSuppressed = true;
    this.stopAllTimers();
    if (record) {
      const event = this.buildEvent({
        stage: this.currentStage ?? "normalization",
        operation: clean,
        status: "failed",
        error: clean,
      });
      this.queueEventLog(event);
    }
    this.clearInteractiveLine();
    this.writeError(`Error: ${clean}\n`);
    this.lastReportedError = clean;
    this.displayedInteractiveLine = false;
  }

  private writeError(message: string): void {
    (this.options.errorOutput ?? this.options.output).write(message);
  }

  private isInteractive(): boolean {
    return Boolean(
      this.options.isTTY &&
        !this.options.verbose &&
        this.options.enabled !== false,
    );
  }

  private startInteractiveOperation(): void {
    if (
      !this.isInteractive() ||
      this.closed ||
      this.finished ||
      this.interactiveSuppressed
    )
      return;
    this.interactiveOperations += 1;
    if (this.interactiveTimer) return;
    this.interactiveTimer = setInterval(() => {
      this.renderInteractiveClock();
    }, 1_000);
  }

  private endInteractiveOperation(): void {
    if (this.interactiveOperations === 0) return;
    this.interactiveOperations -= 1;
    if (this.interactiveOperations === 0) this.stopInteractiveTimer();
  }

  private stopInteractiveTimer(): void {
    if (!this.interactiveTimer) return;
    clearInterval(this.interactiveTimer);
    this.interactiveTimer = undefined;
  }

  private stopAllTimers(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this.stopInteractiveTimer();
    this.interactiveOperations = 0;
  }

  private renderInteractiveClock(): void {
    if (
      !this.isInteractive() ||
      this.closed ||
      this.finished ||
      this.interactiveSuppressed ||
      !this.currentStage
    )
      return;
    const now = (this.options.now ?? Date.now)();
    const compact = formatInteractiveProgress({
      stageIndex: STAGES.indexOf(this.currentStage) + 1,
      stageTotal: STAGES.length,
      description: STAGE_DESCRIPTIONS[this.currentStage],
      stageElapsedMs: Math.max(0, now - this.stageStartedAt.value),
      elapsedMs: Math.max(0, now - this.startedAt),
      terminalWidth: this.terminalWidth,
      workUnit: this.currentWorkUnit,
    });
    this.clearInteractiveLine();
    const active = this.colorEnabled
      ? colorize(compact, "36", true)
      : compact;
    this.options.output.write(`\r${active}`);
    this.displayedInteractiveLine = true;
  }

  private async writeEventLog(event: ProgressEvent): Promise<void> {
    if (!this.options.logPath || !shouldLog(event.severity, this.logLevel))
      return;
    await this.start();
    await appendFile(
      this.options.logPath,
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  }

  private queueEventLog(event: ProgressEvent): void {
    if (!this.options.logPath || !shouldLog(event.severity, this.logLevel))
      return;
    const pending = this.writeEventLog(event);
    this.pendingLogs.add(pending);
    void pending.then(
      () => this.pendingLogs.delete(pending),
      () => this.pendingLogs.delete(pending),
    );
  }

  private queueStageCompletionLog(
    completion: ProgressStageCompletion,
  ): void {
    const severity = completion.status === "failed" ? "error" : "info";
    if (!this.options.logPath || !shouldLog(severity, this.logLevel)) return;
    const pending = this.writeStageCompletionLog(completion);
    this.pendingLogs.add(pending);
    void pending.then(
      () => this.pendingLogs.delete(pending),
      () => this.pendingLogs.delete(pending),
    );
  }

  private async writeStageCompletionLog(
    completion: ProgressStageCompletion,
  ): Promise<void> {
    if (!this.options.logPath) return;
    await this.start();
    await appendFile(
      this.options.logPath,
      `${JSON.stringify({
        kind: "stage-completion",
        ...completion,
        timestamp: new Date().toISOString(),
        severity: completion.status === "failed" ? "error" : "info",
      })}\n`,
      "utf8",
    );
  }

  private formatDetailed(event: ProgressEvent): string {
    const elapsed = `${(event.elapsedMs / 1000).toFixed(1)}s`;
    const stageElapsed = formatTimestamp(event.stageElapsedMs / 1000);
    const chunk =
      event.chunkIndex === undefined
        ? ""
        : ` chunk ${event.chunkIndex + 1}/${event.chunkCount ?? "?"}`;
    const pass = event.pass ? ` pass ${sanitizeProgressText(event.pass)}` : "";
    const workUnit = event.workUnit
      ? ` ${sanitizeProgressText(event.workUnit.label)} ${Math.max(0, event.workUnit.index) + 1}/${event.workUnit.total}`
      : "";
    const attempt =
      event.attempt !== undefined && event.maxAttempts !== undefined
        ? ` attempt ${event.attempt}/${event.maxAttempts}`
        : "";
    const diagnostic = event.diagnosticPath
      ? ` (${sanitizeProgressText(event.diagnosticPath)})`
      : "";
    return `[${event.timestamp}] stage ${event.stageIndex}/${event.stageTotal} ${event.stage} ${event.status}: ${sanitizeProgressText(event.operation)}${pass}${chunk}${workUnit}${attempt}; stage elapsed ${stageElapsed}; elapsed ${elapsed}${diagnostic}`;
  }
}

export function progressStages(): readonly ProgressStage[] {
  return STAGES;
}
