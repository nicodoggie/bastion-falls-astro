# Transcribe Archive `--all` Design

## Goal

Add `--all` to `bfcli transcribe archive` so it can archive every immediate session subdirectory in the configured `transcribe.transcribeDir`.

## Behavior

- `bfcli transcribe archive <session>` remains unchanged for single-session use.
- `bfcli transcribe archive --all` archives each immediate child directory of `transcribeDir`.
- `--all` cannot be combined with a positional session argument.
- Files in `transcribeDir` are ignored; only immediate directories are considered sessions.
- Bulk mode runs sequentially to avoid multiple simultaneous ffmpeg encodes and unreadable progress output.
- In bulk mode, an existing output is skipped unless `--force` is provided:
  - compressed output exists: `<outputDir>/<sessionName>.zip`
  - uncompressed output exists: `<outputDir>/<sessionName>/`
- With `--all --force`, existing outputs are replaced using the existing safe temp-output flow.
- If a session fails because required inputs are missing or encoding/archive writing fails, bulk mode records the failure and continues to the next session.
- At the end, bulk mode prints a summary containing total, archived, skipped existing, and failed counts.
- Bulk mode exits with code `0` when there are no failures, even if some sessions were skipped.
- Bulk mode exits non-zero when any session failed.

## Implementation

Refactor the existing `archive` handler into reusable pieces:

- A single-session function that performs the existing archive operation and returns the final destination.
- A bulk function that lists immediate session directories, skips existing outputs when appropriate, invokes the single-session function sequentially, and summarizes results.

Keep the existing safe replacement behavior from the current archive command: do not remove an old destination until encoding and temp archive creation have succeeded.

## Testing

Add focused unit tests for pure bulk helpers:

- `formatArchiveSummary` includes the expected counts and failed session names.
- `shouldSkipExistingArchive` returns true only in bulk mode when the destination exists and `--force` is not set.

Validate with:

- Focused archive tests.
- CLI typecheck/build.
- `transcribe archive --help` showing `--all`.
- A lightweight smoke command as practical; avoid full multi-session real-audio archival unless explicitly needed because it is expensive.
