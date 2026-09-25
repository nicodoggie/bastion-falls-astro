# Transcription progress

`bfcli transcribe` reports operational progress without estimating model completion.

## Console output

The default TTY display owns one terminal line and uses this shape:

```text
Stage 5/6: Reconciling · chunk 8/43 [stage][total]
Stage 3/6: Transcribing · left 8/43 [stage][total]
```

The first clock is stage elapsed time and the second is total invocation elapsed time. Neither is a wall-clock timestamp, and neither resets for chunks, passes, heartbeats, or media callbacks. Counts come from the planned work list: ASR uses `left`, reconciliation uses `chunk`, and notes use `chunk`, `scene`, and `final summary`. Cache reuse and retries keep the same item count. Stages without planned units omit the counter. Descriptions are stable per stage, control characters are sanitized, and narrow terminals yield the description before the counter and clocks. The renderer clears the previous line before replacing it and clears it before reporting an error.

The display keeps one active line for the current stage and appends one permanent line when a real stage reaches a terminal outcome. Completion lines use `✓` for work completed in this invocation, `↻` for reused checkpoint work, `–` for an intentional skip, and `×` for failure. Each completion line freezes both clocks at that boundary; the final completion line is left visible when the reporter closes. Chunk, pass, retry, heartbeat, and media events remain transient or structured-log-only and never create stage-history lines.

Non-TTY output uses the same compact line as append-only plain text. `--verbose` disables animated rendering and emits timestamped operational detail to stdout instead. Routine detail is not printed in the default TTY/non-TTY modes; failures remain visible on stderr. Package-manager or shell banners printed before the CLI owns its streams are outside this routing boundary.

## Severity and filtering

The transcribe logger has four levels: `debug`, `info`, `warn`, and `error` (`warning` is accepted as an alias for `warn`). The resolved threshold is selected in this order:

1. `--log-level <level>`
2. `--verbose` implies `debug` when no explicit level is supplied
3. `transcribe.progress.logLevel` in `.bfcli.yml`
4. `info`

The threshold filters the session JSONL log and detailed logger sinks. It does not hide the compact lifecycle display. Warnings and errors use renderer-safe stderr output; fatal errors are never filtered. `--log-level` by itself does not enable verbose console output.

Example:

```text
bfcli transcribe run --log-level warn ...
```

## Session log

A private session-local JSONL operational log is enabled by default at `transcription-progress.jsonl` in the session output directory. Configure it in `.bfcli.yml` under `transcribe.progress`:

```yaml
transcribe:
  progress:
    log: true
    logPath: .bf-transcripts/progress.jsonl
    logLevel: info
    heartbeatSeconds: 30
```

Set `log: false` to disable the operational log. Entries contain timestamps, severity, elapsed durations, stage/work-unit metadata, statuses, retry attempt metadata, and diagnostic paths. Reconciliation and notes emit structured `started`, `reused`, `retry`, and `completed` unit events. They deliberately do not contain transcript text, prompt bodies, or model output.
