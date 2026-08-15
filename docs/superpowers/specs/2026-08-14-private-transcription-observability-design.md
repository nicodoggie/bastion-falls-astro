# Private Transcription Observability Design

**Date:** 2026-08-14
**Status:** Approved for implementation planning
**Target branch:** `main`

## Purpose

Build an always-on private observability service for Bastion Falls transcription and the Linux/M1
hosts that perform it. The first milestone must explain both workflow behavior and machine behavior,
including pathological cases such as a worker remaining computationally active while decoded-audio
progress does not advance.

The service is intentionally extensible to other private household systems, but the first
implementation is limited to transcription and host health.

## Approved Decisions

- Monitor transcription plus Linux and M1 host health.
- Run Grafana and Prometheus as a Docker Compose core on Linux.
- Run host and application collectors natively through systemd on Linux and launchd on the M1.
- Expose Grafana only through private Tailscale HTTPS.
- Do not expose Prometheus or the history datastore as general tailnet services.
- Retain high-resolution Prometheus samples for three days.
- Retain canonical workflow history and aggregates indefinitely in a private SQLite ledger.
- Make observability non-blocking: metrics or ledger failures must not prevent transcript
  persistence, checkpoint advancement, or durable remote-job cleanup.

## Scope

### Included in milestone one

- Session audio duration and total workflow wall time.
- Per-chunk and per-pass timing for raw transcription.
- Per-chunk timing for Codex correction.
- Per-chunk timing for summary-safe cleanup.
- Separate notes-generation timing.
- Queue, inference, result-download, local-persistence, checkpoint, and cleanup timings where the
  durable remote protocol exposes those boundaries.
- Linux CPU, memory, swap, filesystem, disk I/O, network, NVIDIA utilization, and VRAM.
- M1 CPU, memory pressure, swap, filesystem, network, worker process state, model-loaded state,
  queue depth, and available thermal/power indicators that do not require broad privileges.
- Engine/model/pass comparisons and real-time factor.
- Explicit completed, failed, cancelled, retried, reused, and deferred outcomes.
- Truthful engine progress when an engine exposes decoded audio or completed window position.
- Dashboard-as-code, datasource provisioning, validation, deployment, backup, and restore
  documentation.

### Deferred

- General Hermes and household-service dashboards.
- Public or LAN-wide access.
- Alert delivery to external messaging systems.
- Transcript text, prompts, generated notes, participant identity, or audio in telemetry.
- Distributed tracing.
- A long-term time-series database such as VictoriaMetrics.
- Retrofitting detailed timing from old logs where event boundaries cannot be established reliably.

## Architecture

### Linux observability core

A single Docker Compose project under `ops/observability/` owns:

- Grafana;
- Prometheus;
- the signed Grafana SQLite datasource plugin;
- persistent Grafana and Prometheus volumes;
- provisioned datasources, folders, and dashboards;
- Prometheus scrape and recording-rule configuration.

Images and plugins are pinned by immutable version or digest in a checked-in lock file. Prometheus
runs with three-day time retention and a bounded size limit. Grafana and Prometheus bind only to
loopback or the private Compose network.

Tailscale Serve terminates private tailnet HTTPS and proxies to Grafana on Linux loopback.
Repository configuration must not contain reusable Grafana credentials or tailnet secrets.

### Native collectors

Linux uses systemd-managed native collectors:

- `node_exporter` for host metrics;
- a narrow NVIDIA exporter using the local `nvidia-smi` contract;
- a Bastion workflow exporter that reads the SQLite ledger and exposes bounded live aggregates.

The M1 uses launchd-managed native collectors:

- `node_exporter` or an equivalently bounded Darwin host exporter;
- the remote-STT supervisor’s Prometheus endpoint for durable job, worker, and engine metrics.

Collectors bind to loopback when scraped from the same host. An M1 endpoint required by Linux
Prometheus binds only to the M1 Tailscale address or is published through a private Tailscale proxy.
It is never exposed through the public internet or router.

### Control-plane separation

The durable remote-STT API remains authoritative for admission, status, result retrieval, and
deletion. Prometheus only observes. Neither Grafana nor Prometheus can admit, retry, cancel, delete,
or mutate transcription jobs.

## Data Model

### SQLite ledger

The canonical ledger is append-oriented and uses WAL mode, foreign keys, bounded busy timeouts,
explicit schema migrations, and transactional stage transitions.

Core entities:

- `sessions`: campaign-safe identifier, session date, source fingerprint, audio duration, creation
  time;
- `workflow_runs`: profile/layout, overall start/end, terminal outcome;
- `chunk_runs`: pass, chunk index, audio start/end/duration, result/deferred state;
- `stage_attempts`: stage, engine/model, attempt ordinal, queued/start/end timestamps, outcome,
  bounded error code;
- `stage_results`: segment count, final decoded timestamp, fallback/retry count, byte counts, and
  other bounded summaries;
- `daily_aggregates`: daily totals and quantiles produced from canonical attempts.

Stage names are finite and stable:

- `normalization`
- `audio_chunking`
- `raw_transcription`
- `raw_assembly`
- `codex_correction`
- `hermes_reconciliation`
- `summary_safe_cleanup`
- `notes_generation`

A logical attempt key prevents coordinator restart or durable-job reattachment from creating
duplicate successful work. Reused cache artifacts are represented as `reused`, not as zero-duration
inference. Deliberately skipped chunk 35-style artifacts are represented as `deferred`, not as
successful empty audio.

Historical views expose two distinct totals. Workflow elapsed time spans the run's first start
through terminal completion and therefore includes pauses or disconnects. Active processing time
sums actual stage-attempt durations and excludes idle gaps. Dashboards must not label one as the
other.

The ledger contains no transcript text, generated notes, prompts, filenames, API credentials,
participant names, raw errors, or arbitrary metadata maps.

### Prometheus telemetry

Prometheus owns live, bounded operational series. Permitted labels are finite dimensions such as:

- `host`
- `service`
- `stage`
- `engine`
- `model_profile`
- `pass`
- `state`
- `outcome`

Session IDs, chunk indices, durable job IDs, file paths, fingerprints, prompts, transcript text, and
raw error messages are forbidden labels.

Metric families include:

- stage attempts and outcomes;
- stage-duration histograms;
- audio-duration and real-time-factor summaries derived from completed attempts;
- current queue depth and worker/model state;
- current elapsed time;
- processed-audio seconds and total-audio seconds when genuinely available;
- admission, upload, queue, inference, result-download, persistence, checkpoint, and cleanup
  durations;
- retries, fallbacks, stale-job reconciliation, and deferred cleanup counts;
- host resource metrics from the native exporters.

A percentage is emitted or graphed only when both processed and total audio positions are real
engine data. Worker activity and elapsed time are liveness signals, not progress.

## Instrumentation Boundaries

The workflow instrumentation follows existing source boundaries rather than parsing journal strings:

- `pipeline.ts` records session, pass, chunk, artifact persistence, checkpoint, cleanup, and stage
  transitions.
- `sttBackend.ts` records engine/profile attribution around raw transcription.
- `openAiStt.ts` records admission/attachment, status polling, result availability, and download
  boundaries.
- `codex.ts` records each correction, summary-safe cleanup, and notes-generation chunk.
- `hermesReview.ts` records reconciliation separately from Codex correction.
- the M1 `supervisor.py` records queue, claim, worker startup, inference, success/failure,
  reconciliation, and TTL cleanup.

Timing uses monotonic clocks for elapsed durations and UTC wall-clock timestamps for correlation.

Ledger recording is best-effort and structurally isolated from workflow correctness. A recording
failure emits a bounded warning and leaves a recoverable local spool event; it never changes the
workflow result. The spool is bounded and replayed idempotently by the workflow exporter.

## Retention and Aggregation

- Prometheus raw samples: three days.
- Prometheus scrape interval: 10–15 seconds for transcription/application targets and 15–30 seconds
  for host targets.
- SQLite canonical attempts and aggregates: indefinite unless manually archived.
- Daily aggregation runs idempotently and may be rebuilt from canonical stage attempts.
- Grafana metadata and dashboards persist in a dedicated volume.
- Backups include SQLite and Grafana state; Prometheus raw telemetry is disposable and need not be
  backed up.

SQLite is the source of truth for historical graphs. Prometheus recording rules improve live queries
but do not pretend to provide retention beyond the three-day TSDB window.

## Dashboards

### Bastion Falls / Live Transcription

- active stage and pass;
- queue depth and worker/model state;
- elapsed wall time;
- real processed-audio progress where available;
- current real-time factor;
- CPU/RAM/GPU/VRAM alongside progress;
- latest bounded outcome/error code;
- stall indication based on a genuine non-advancing cursor.

### Bastion Falls / Session History

- session audio length in minutes over time;
- workflow elapsed time and active processing time;
- active processing time versus audio duration;
- stage-duration waterfall;
- success, failure, cancellation, reuse, and deferral counts;
- daily and monthly aggregate throughput.

### Bastion Falls / Chunk Performance

- per-chunk raw transcription duration;
- Codex correction duration;
- summary-safe cleanup duration;
- separate notes generation and Hermes reconciliation;
- heatmap of chunk position versus duration;
- stereo/left/right comparison;
- timestamp coverage and segment density;
- retry and fallback distributions.

### Bastion Falls / Engine Comparison

- MLX Whisper, whisper.cpp, and future engine profiles;
- real-time factor distributions;
- queue and inference durations;
- memory and accelerator use;
- failures, stalls, retries, and fallback behavior;
- quality-proxy summaries that are actually present in engine output.

### Hosts / Linux and M1

- CPU and load;
- memory, compression/swap, and pressure;
- disk/filesystem and I/O;
- network;
- process uptime/restarts;
- NVIDIA GPU/VRAM on Linux;
- available M1 thermal/power and worker/model state.

Dashboard queries explicitly name their datasource. SQLite panels use only approved views;
Prometheus panels use only proven metric names. No dashboard contains mutation controls.

## Privacy and Access

- Grafana is reachable only over the tailnet HTTPS endpoint.
- Anonymous Grafana access is disabled.
- Grafana credentials are supplied out-of-repository through a protected environment file or
  password manager handoff.
- Prometheus, SQLite, and exporters are not exposed publicly.
- SQLite datasource access is read-only and limited to approved views.
- Dashboards display campaign-safe operational metadata, not story or participant content.
- Raw audio and transcript artifacts remain in their existing private storage and are never copied
  into the observability stack.

## Failure Handling

- Prometheus or Grafana downtime does not affect transcription.
- Ledger lock/contention uses bounded retries and a local bounded spool.
- Spool replay is idempotent.
- Exporter failure produces missing telemetry rather than false zeroes.
- Unsupported progress appears as unknown/no data.
- SQLite migrations are transactional and backed up before upgrade.
- Prometheus storage exhaustion is bounded by time and size retention.
- Host collectors run without broad root privileges; unavailable privileged metrics are omitted
  rather than weakening host security.

## Testing and Acceptance

### Static and unit tests

- SQLite schema/migration and idempotent transition tests.
- Duplicate reattachment and cache-reuse semantics.
- Best-effort telemetry failure tests proving transcript/checkpoint correctness remains intact.
- Metric label allowlist and high-cardinality rejection tests.
- Prometheus exposition parsing tests.
- Dashboard validator tests for datasource ownership, approved SQLite views, forbidden
  fields/labels, and exact dashboard inventory.
- Compose and Prometheus configuration validation.

### Live acceptance

- Run a bounded transcription fixture.
- Prove raw transcription, local artifact persistence, checkpoint advancement, and cleanup appear
  with correct durations.
- Run or simulate correction and summary-safe cleanup and prove separate stage timings.
- Verify Linux and M1 scrape targets are healthy over the intended private paths.
- Verify Grafana is reachable over Tailscale HTTPS and not through a public or LAN-wide listener.
- Restart Grafana/Prometheus and prove provisioned dashboards return.
- Restart the workflow exporter and prove ledger history remains and spool replay does not duplicate
  attempts.
- Verify three-day Prometheus retention configuration and bounded storage.
- Scan rendered configuration, dashboard JSON, SQLite views, and metric output for forbidden
  sensitive fields.

## Rollout Order

1. Merge the durable remote-STT feature into `main` before instrumenting its source boundaries.
1. Add and validate the SQLite ledger independently.
1. Instrument the CLI stages without deploying Grafana.
1. Instrument the M1 supervisor and prove its metrics privately.
1. Add native host exporters.
1. Add the Compose core and provisioned datasources.
1. Add validated dashboards.
1. Configure Tailscale Serve and run bounded live acceptance.

This ordering ensures useful canonical timing data exists before presentation work and avoids
inventing dashboard queries ahead of implemented metrics.
