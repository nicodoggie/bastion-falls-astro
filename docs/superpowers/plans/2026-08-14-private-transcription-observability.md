# Private Transcription Observability Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task after
> the durable remote-STT feature is merged into `main`.

**Goal:** Deploy an always-on, Tailscale-private Grafana/Prometheus service that explains Bastion
transcription performance and Linux/M1 host health while preserving canonical long-term workflow
timing in SQLite.

**Architecture:** The TypeScript CLI writes idempotent workflow events into a private SQLite ledger
and exposes bounded live aggregates through a native systemd service. The M1 supervisor exposes
bounded Prometheus metrics directly, while native host exporters provide Linux/M1 health. Grafana
and three-day Prometheus run in Docker Compose on Linux and consume only proven metrics and approved
read-only SQLite views.

**Tech Stack:** TypeScript 6, Node.js, `better-sqlite3`, `prom-client`, Python/FastAPI
`prometheus-client`, SQLite WAL, Prometheus, Grafana, signed SQLite datasource plugin, Docker
Compose, systemd, launchd, Tailscale Serve.

**Design:** `docs/superpowers/specs/2026-08-14-private-transcription-observability-design.md`

---

## Preconditions

- Merge the durable remote-STT feature branch into `main` through the repository's normal reviewed
  workflow.
- Confirm `main` contains:
  - `cli/ops/remote-stt/macos/job_store.py`
  - `cli/ops/remote-stt/macos/supervisor.py`
  - `cli/src/commands/transcribe/openAiStt.ts`
  - hybrid pass/chunk support in `cli/src/commands/transcribe/pipeline.ts`
- Preserve existing dirty/untracked work in the primary worktree.
- Do not copy generated transcript state, credentials, or local SQLite data into Git.
- Resolve and pin current compatible container/plugin/exporter versions during Task 8; do not use
  floating `latest` tags.

## Task 1: Add the SQLite ledger schema and migration runner

**Objective:** Create a transactional, versioned SQLite history store with no transcript-content
columns.

**Files:**

- Modify: `cli/package.json`
- Create: `cli/src/commands/observability/ledger.ts`
- Create: `cli/src/commands/observability/schema.ts`
- Create: `cli/src/commands/observability/migrations/001-initial.ts`
- Create: `cli/src/commands/observability/ledger.test.ts`

**Steps:**

1. Add pinned `better-sqlite3` and its TypeScript declarations to the CLI package.
1. Write failing tests for schema creation, WAL mode, foreign keys, migration idempotency, and
   reopening an existing ledger.
1. Define strict finite enums for stage and outcome values.
1. Create normalized tables for sessions, workflow runs, chunks, stage attempts, stage results,
   schema migrations, and daily aggregates.
1. Add uniqueness constraints for logical attempt identity and successful terminal results.
1. Explicitly test that the schema has no columns for transcript text, prompts, filenames,
   participant names, arbitrary metadata JSON, credentials, or raw error strings.
1. Run the focused test, then CLI typecheck and build.

**Commands:**

```bash
pnpm install --lockfile-only
(cd cli && node --import tsx --test src/commands/observability/ledger.test.ts)
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
```

**Expected:** Focused ledger tests pass; CLI typecheck/build pass; `pnpm-lock.yaml` records exact
dependency resolution.

**Commit boundary:** `feat(observability): add transcription workflow ledger`

## Task 2: Implement idempotent workflow recording and bounded spooling

**Objective:** Record stage transitions without allowing observability failure to fail
transcription.

**Files:**

- Create: `cli/src/commands/observability/recorder.ts`
- Create: `cli/src/commands/observability/spool.ts`
- Create: `cli/src/commands/observability/recorder.test.ts`
- Create: `cli/src/commands/observability/spool.test.ts`

**Steps:**

1. Write failing tests for begin, succeed, fail, cancel, reuse, and defer transitions.
1. Test coordinator restart and durable-job reattachment against the same logical attempt key.
1. Use monotonic elapsed timing and UTC correlation timestamps.
1. Implement bounded SQLite busy retries.
1. On unavailable SQLite, atomically append a schema-validated event to a bounded private spool
   directory.
1. Reject or rotate the oldest spool material at the configured byte limit; never block the workflow
   indefinitely.
1. Replay spool events transactionally and idempotently.
1. Add a no-op recorder used when observability is disabled.
1. Prove with tests that recorder and spool failures leave the caller's workflow result unchanged.

**Commands:**

```bash
(cd cli && node --import tsx --test src/commands/observability/recorder.test.ts src/commands/observability/spool.test.ts)
pnpm -F @bastion-falls/cli typecheck
```

**Expected:** Duplicate events do not duplicate attempts; recorder failures produce bounded warnings
and preserve caller success.

**Commit boundary:** `feat(observability): record workflow stages safely`

## Task 3: Add observability settings and private path handling

**Objective:** Configure the ledger/spool without embedding machine paths or credentials in source.

**Files:**

- Modify: `cli/src/commands/transcribe/settings.ts`
- Modify: `cli/src/commands/transcribe/settings.test.ts`
- Create: `cli/ops/observability/config.example.yaml`
- Modify: `.gitignore`

**Steps:**

1. Add a strict optional `observability` configuration block for enabled state, ledger path, spool
   path, and spool byte limit.
1. Expand `~` or resolve relative paths through the established settings convention.
1. Reject unknown keys, nonpositive limits, and paths inside public site output.
1. Ensure local ledger, WAL, SHM, spool, Grafana state, and Prometheus data paths are ignored.
1. Add an example containing no secret or machine-specific credential.
1. Verify disabled observability preserves current behavior exactly.

**Commands:**

```bash
(cd cli && node --import tsx --test src/commands/transcribe/settings.test.ts)
pnpm -F @bastion-falls/cli typecheck
```

**Expected:** Existing configs remain valid; strict observability config tests pass.

**Commit boundary:** `feat(observability): configure private workflow telemetry`

## Task 4: Instrument raw transcription and durable remote-job boundaries

**Objective:** Measure raw ASR by session, pass, chunk, engine/profile, and durable protocol phase.

**Files:**

- Modify: `cli/src/commands/transcribe/pipeline.ts`
- Modify: `cli/src/commands/transcribe/pipeline.test.ts`
- Modify: `cli/src/commands/transcribe/sttBackend.ts`
- Modify: `cli/src/commands/transcribe/sttBackend.test.ts`
- Modify: `cli/src/commands/transcribe/openAiStt.ts`
- Modify: `cli/src/commands/transcribe/openAiStt.test.ts`

**Steps:**

1. Write focused tests that characterize raw transcription begin/end and the finite `stereo`,
   `left`, and `right` pass labels.
1. Record session audio duration and chunk audio start/end/duration from the manifest.
1. Record backend engine and configured model profile, not secrets or arbitrary URLs.
1. Add durable phase timing for admission/attachment, queue, inference, result download, local JSON
   persistence, Markdown persistence, checkpoint advancement, and cleanup.
1. Record cache reuse as `reused` and explicit placeholders as `deferred`; neither counts as
   successful zero-duration inference.
1. Preserve local-commit-before-remote-cleanup ordering.
1. Prove a throwing recorder cannot prevent JSON/Markdown persistence, checkpoint advancement, or
   cleanup.
1. Prove status polling never creates one event per poll in SQLite; only bounded state transitions
   and final durations are canonical.

**Commands:**

```bash
(cd cli && node --import tsx --test src/commands/transcribe/pipeline.test.ts src/commands/transcribe/sttBackend.test.ts src/commands/transcribe/openAiStt.test.ts)
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
```

**Expected:** Existing durable protocol tests remain green; new timing/idempotency tests pass.

**Commit boundary:** `feat(observability): instrument raw transcription stages`

## Task 5: Instrument correction, reconciliation, summary-safe cleanup, and notes

**Objective:** Preserve separate timings for every model-processing stage requested by the user.

**Files:**

- Modify: `cli/src/commands/transcribe/codex.ts`
- Modify: `cli/src/commands/transcribe/codex.test.ts`
- Modify: `cli/src/commands/transcribe/hermesReview.ts`
- Modify: `cli/src/commands/transcribe/hermesReview.test.ts`
- Modify: `cli/src/commands/transcribe/ollamaNotes.ts`
- Modify: `cli/src/commands/transcribe/ollamaNotes.test.ts`
- Modify: `cli/src/commands/transcribe/command.ts`

**Steps:**

1. Add tests for distinct `codex_correction`, `hermes_reconciliation`, `summary_safe_cleanup`, and
   `notes_generation` attempts.
1. Record each model chunk independently and also close the parent stage.
1. Record resumed/reused outputs truthfully without inventing model processing time.
1. Store model profile and bounded outcome; never store prompt or generated content.
1. Preserve failures as bounded error codes such as `process_exit`, `invalid_output`, or
   `cancelled`; do not store stderr bodies.
1. Confirm summary-safe cleanup is not conflated with notes generation.
1. Confirm current transcript and notes output remain byte-identical with observability enabled or
   disabled.

**Commands:**

```bash
(cd cli && node --import tsx --test src/commands/transcribe/codex.test.ts src/commands/transcribe/hermesReview.test.ts src/commands/transcribe/ollamaNotes.test.ts)
pnpm -F @bastion-falls/cli typecheck
```

**Expected:** Every model stage has independent attempts and aggregate duration; output behavior is
unchanged.

**Commit boundary:** `feat(observability): instrument transcript model passes`

## Task 6: Build the native Linux workflow and NVIDIA exporter

**Objective:** Expose bounded live Prometheus metrics from the ledger and local NVIDIA runtime.

**Files:**

- Modify: `cli/package.json`
- Create: `cli/src/commands/observability/metrics.ts`
- Create: `cli/src/commands/observability/exporter.ts`
- Create: `cli/src/commands/observability/exporter.test.ts`
- Create: `cli/src/commands/observability/command.ts`
- Modify: `cli/src/app.ts`
- Create: `ops/observability/systemd/bastion-observability-exporter.service`

**Steps:**

1. Add pinned `prom-client`.
1. Write tests for exact metric inventory and finite label allowlists.
1. Reject session IDs, chunk indices, job IDs, paths, fingerprints, prompts, and raw errors as
   Prometheus labels.
1. Export live queue/stage/outcome gauges and cumulative bounded counters derived from SQLite.
1. Export current elapsed and genuine processed/total audio only when present.
1. Query `nvidia-smi` with a fixed field list and parse bounded numeric values; expose no process
   command lines or usernames.
1. Return missing metrics rather than zeros when NVIDIA data is unavailable.
1. Add a loopback-bound HTTP server and health endpoint.
1. Add a hardened user systemd unit with explicit state paths and restart policy.
1. Validate exposition with Prometheus's parser or `promtool` fixture tests.

**Commands:**

```bash
(cd cli && node --import tsx --test src/commands/observability/exporter.test.ts)
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
```

**Expected:** Metrics parse successfully; forbidden labels are structurally impossible.

**Commit boundary:** `feat(observability): expose workflow and GPU metrics`

## Task 7: Instrument the M1 durable supervisor

**Objective:** Export truthful queue, worker, inference, and cleanup metrics from the M1 service.

**Files:**

- Create: `cli/ops/remote-stt/macos/requirements.txt`
- Modify: `cli/ops/remote-stt/macos/supervisor.py`
- Modify: `cli/ops/remote-stt/macos/job_store.py`
- Modify: `cli/ops/remote-stt/macos/test_supervisor.py`
- Modify: `cli/ops/remote-stt/macos/test_job_store.py`
- Modify: `cli/ops/remote-stt/macos/config.example.yaml`

**Steps:**

1. Add and pin the Python Prometheus client through the existing M1 installation contract.
1. Write tests for queue depth, job transitions, attempts, worker/model state, inference duration,
   TTL cleanup, and reconciliation.
1. Expose `/metrics` on the supervisor, protected by the same private-network boundary but not by
   credentials embedded in Prometheus config.
1. Never label metrics with durable job ID or payload path.
1. Export decoded-audio progress only through an engine adapter callback that supplies real
   completed seconds/windows.
1. For current synchronous MLX, export running/liveness/elapsed while leaving progress absent.
1. Add a forward-progress guard metric and bounded error code for future engine adapters without
   claiming the MLX loop is fixed by instrumentation.
1. Verify API control routes and durable behavior remain unchanged.

**Commands:**

```bash
python -m unittest discover -s cli/ops/remote-stt/macos -p 'test_*.py'
python -m compileall -q cli/ops/remote-stt/macos
```

**Expected:** Metrics tests and all durable-store/supervisor tests pass.

**Commit boundary:** `feat(observability): expose remote STT metrics`

## Task 8: Add native Linux and M1 host exporters

**Objective:** Install least-privileged native host telemetry collectors on both machines.

**Files:**

- Create: `ops/observability/versions.env`
- Create: `ops/observability/scripts/install-linux-exporters.sh`
- Create: `ops/observability/scripts/install-macos-exporters.sh`
- Create: `ops/observability/systemd/node-exporter.service`
- Create: `ops/observability/launchd/com.bastion-falls.node-exporter.plist`
- Create: `ops/observability/tests/exporter-install.test.ts`

**Steps:**

1. Resolve current production releases from official Prometheus/Grafana sources and pin exact
   versions plus SHA-256 checksums in `versions.env`.
1. Download only official release artifacts and verify checksums before installation.
1. Bind Linux node exporter to loopback because Prometheus runs on the same host via a host-gateway
   route.
1. Bind the M1 exporter only to its Tailscale address or a Tailscale-published private listener.
1. Enable only useful bounded collectors; omit collectors requiring broad root access.
1. Install systemd/launchd units transactionally with rollback copies.
1. Add fixture tests for architecture selection, checksum failure, bind address, and generated unit
   validity.
1. Run live local scrape smoke on both hosts.

**Commands:**

```bash
node --import tsx --test ops/observability/tests/exporter-install.test.ts
systemd-analyze verify ops/observability/systemd/*.service
plutil -lint ops/observability/launchd/*.plist
```

**Expected:** Units validate; collectors bind only to approved interfaces; scrape smoke succeeds.

**Commit boundary:** `feat(observability): add private host exporters`

## Task 9: Provision the Docker Compose observability core

**Objective:** Run pinned Grafana and three-day Prometheus with private storage and datasources.

**Files:**

- Create: `ops/observability/compose.yaml`
- Create: `ops/observability/.env.example`
- Create: `ops/observability/prometheus/prometheus.yml`
- Create: `ops/observability/prometheus/rules/transcription.yml`
- Create: `ops/observability/grafana/Dockerfile`
- Create: `ops/observability/grafana/provisioning/datasources/datasources.yaml`
- Create: `ops/observability/grafana/provisioning/dashboards/provider.yaml`
- Create: `ops/observability/scripts/validate-compose.sh`

**Steps:**

1. Pin Grafana and Prometheus to exact production versions/digests from `versions.env`.
1. Install the signed SQLite datasource plugin at an exact compatible version in the Grafana image.
1. Configure Prometheus with `--storage.tsdb.retention.time=3d` and a conservative size cap.
1. Bind Grafana and Prometheus to Linux loopback only.
1. Mount the SQLite ledger directory read-only into Grafana; provision an approved read-only
   datasource.
1. Add host-gateway routing for Linux-native exporters and a Tailscale/MagicDNS scrape target for
   the M1.
1. Disable anonymous Grafana access and keep admin credentials in an ignored protected environment
   file.
1. Add health checks, restart policies, read-only config mounts, and persistent named volumes.
1. Validate Compose rendering and Prometheus configuration.

**Commands:**

```bash
docker compose -f ops/observability/compose.yaml config --quiet
promtool check config ops/observability/prometheus/prometheus.yml
promtool check rules ops/observability/prometheus/rules/transcription.yml
```

**Expected:** Compose and Prometheus configuration validate; rendered ports expose only loopback.

**Commit boundary:** `feat(observability): provision private Grafana and Prometheus`

## Task 10: Add approved SQLite views and dashboard safety validation

**Objective:** Give Grafana a stable read-only query contract and reject unsafe dashboards.

**Files:**

- Create: `cli/src/commands/observability/views.ts`
- Create: `cli/src/commands/observability/views.test.ts`
- Create: `ops/observability/validate-dashboards.ts`
- Create: `ops/observability/validate-dashboards.test.ts`
- Modify: `cli/package.json`

**Steps:**

1. Add explicit views for session history, stage attempts, chunk performance, engine comparison, and
   daily aggregates.
1. Expose workflow elapsed time and active stage-duration sums as separate columns with unambiguous
   names.
1. Exclude raw internal identifiers and every forbidden content field from views.
1. Write a dashboard validator before adding dashboards.
1. Require an exact dashboard UID/file inventory.
1. Permit only the provisioned Prometheus and SQLite datasource UIDs.
1. Reject mutation SQL, unapproved tables/views, unsafe variable interpolation, forbidden labels,
   raw paths, and sensitive field names.
1. Test malformed JSON, missing/extra dashboards, datasource drift, and every forbidden query
   category.

**Commands:**

```bash
(cd cli && node --import tsx --test src/commands/observability/views.test.ts)
node --import tsx --test ops/observability/validate-dashboards.test.ts
```

**Expected:** Validator is RED before dashboards and enforces the complete safety contract.

**Commit boundary:** `feat(observability): define safe dashboard query contracts`

## Task 11: Build the five milestone dashboards as code

**Objective:** Provide useful live, historical, chunk, engine, and host views from proven metrics.

**Files:**

- Create: `ops/observability/grafana/dashboards/bastion-live-transcription.json`
- Create: `ops/observability/grafana/dashboards/bastion-session-history.json`
- Create: `ops/observability/grafana/dashboards/bastion-chunk-performance.json`
- Create: `ops/observability/grafana/dashboards/bastion-engine-comparison.json`
- Create: `ops/observability/grafana/dashboards/hosts-linux-m1.json`
- Modify: `ops/observability/validate-dashboards.test.ts`

**Steps:**

1. Inventory every implemented metric and approved SQLite view before writing panels.
1. Build Live Transcription with truthful progress/no-data semantics and host resources alongside
   inference.
1. Build Session History with session length, workflow elapsed time, active processing time, stage
   waterfall, and long-lived aggregates.
1. Build Chunk Performance with separate raw ASR, Codex correction, summary-safe cleanup,
   reconciliation, and notes timings.
1. Build Engine Comparison with real-time factor, resource use, fallback/retry/failure/stall
   outcomes.
1. Build Hosts with Linux/M1 CPU, memory, swap/pressure, disk, network, process uptime, and
   available accelerator data.
1. Include a chunk-duration heatmap where chunk 35-style anomalies are visually obvious without
   using chunk index as a Prometheus label; use SQLite for that panel.
1. Make no-data visibly distinct from zero and errors.
1. Run exact inventory and safety validation.

**Commands:**

```bash
node --import tsx ops/observability/validate-dashboards.ts --complete
node --import tsx --test ops/observability/validate-dashboards.test.ts
```

**Expected:** Exactly five approved dashboards pass datasource, query, privacy, and inventory
checks.

**Commit boundary:** `feat(observability): add transcription and host dashboards`

## Task 12: Add aggregation, backup, and restore operations

**Objective:** Retain canonical history indefinitely without backing up disposable Prometheus
samples.

**Files:**

- Create: `cli/src/commands/observability/aggregate.ts`
- Create: `cli/src/commands/observability/aggregate.test.ts`
- Create: `ops/observability/scripts/backup.sh`
- Create: `ops/observability/scripts/restore.sh`
- Create: `ops/observability/systemd/bastion-observability-aggregate.service`
- Create: `ops/observability/systemd/bastion-observability-aggregate.timer`

**Steps:**

1. Write idempotent daily aggregation tests from canonical stage attempts.
1. Calculate counts, sums, means, min/max, and stable quantiles needed by dashboards.
1. Make aggregate rebuild safe for any date range.
1. Back up SQLite with its online backup API rather than copying a live WAL database blindly.
1. Back up Grafana state/configuration separately; explicitly exclude Prometheus TSDB data.
1. Verify restore into a temporary directory and query row counts/views.
1. Validate timer units and bounded retention of backup generations.

**Commands:**

```bash
(cd cli && node --import tsx --test src/commands/observability/aggregate.test.ts)
systemd-analyze verify ops/observability/systemd/bastion-observability-aggregate.*
```

**Expected:** Repeated aggregation is identical; backup/restore smoke preserves ledger and Grafana
state.

**Commit boundary:** `feat(observability): retain workflow aggregates safely`

## Task 13: Configure private Tailscale HTTPS access

**Objective:** Publish Grafana privately without widening Prometheus/exporter access.

**Files:**

- Create: `ops/observability/scripts/configure-tailscale-serve.sh`
- Create: `ops/observability/scripts/verify-access.sh`
- Create: `ops/observability/ACCESS.md`

**Steps:**

1. Discover the Linux tailnet identity with `tailscale status --json`; do not hard-code credentials
   or a public hostname.
1. Configure Tailscale Serve HTTPS to proxy Grafana loopback port 3000.
1. Preserve and print a rollback command before changing Serve configuration.
1. Verify Grafana health over tailnet HTTPS from the M1.
1. Verify Grafana, Prometheus, and exporters are not listening on public/LAN wildcard addresses.
1. Verify Prometheus and SQLite are not published through Tailscale Serve.
1. Document credential handoff without storing secrets in Git.

**Commands:**

```bash
bash ops/observability/scripts/configure-tailscale-serve.sh --check
bash ops/observability/scripts/verify-access.sh
```

**Expected:** Grafana works over tailnet HTTPS; internal data services remain private.

**Commit boundary:** `feat(observability): publish Grafana over Tailscale`

## Task 14: Run bounded end-to-end acceptance

**Objective:** Prove the deployed stack records and displays a real workflow without affecting
correctness.

**Files:**

- Create: `ops/observability/scripts/acceptance.sh`
- Create: `ops/observability/ACCEPTANCE.md`
- Modify: `cli/ops/remote-stt/README.md`
- Create: `ops/observability/README.md`

**Steps:**

1. Start the native exporters and Compose core.
1. Verify every intended Prometheus target is healthy and no unexpected target exists.
1. Run a short durable remote-STT fixture and verify admission, queue, inference, download, local
   persistence, checkpoint, and cleanup timings.
1. Run bounded correction and summary-safe cleanup fixtures and verify separate stage attempts.
1. Query SQLite views for the fixture and verify no duplicate attempts after replay/reattachment.
1. Query Prometheus for live metrics and absence of forbidden labels.
1. Open every dashboard through Tailscale HTTPS and verify representative panels have data.
1. Restart Grafana, Prometheus, and the workflow exporter; verify dashboards/history return and
   spool replay is idempotent.
1. Deliberately make the ledger unavailable during a disposable fixture; prove transcription still
   succeeds and the bounded spool later replays.
1. Verify raw Prometheus retention flags report three days and the configured size cap.
1. Scan repository config, rendered Compose, dashboard JSON, metric output, and SQLite schema/views
   for credentials, transcript text, participant names, paths, and high-cardinality identifiers.
1. Record exact commands and outputs in `ACCEPTANCE.md` without secrets.

**Commands:**

```bash
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
node --import tsx ops/observability/validate-dashboards.ts --complete
docker compose -f ops/observability/compose.yaml config --quiet
promtool check config ops/observability/prometheus/prometheus.yml
promtool check rules ops/observability/prometheus/rules/transcription.yml
bash ops/observability/scripts/acceptance.sh
pnpm lint
pnpm fmt
pnpm build
```

**Expected:** All focused and repository gates pass; live acceptance proves private access, truthful
stage timing, host telemetry, restart persistence, idempotency, and non-blocking failure behavior.

**Commit boundary:** `docs(observability): add verified operations and acceptance`

## Final Review Checklist

- [ ] Durable remote-STT implementation was merged before instrumentation.
- [ ] No transcript/audio/prompt/participant content enters metrics or SQLite.
- [ ] No high-cardinality session/chunk/job identifiers appear in Prometheus labels.
- [ ] Raw transcription, Codex correction, summary-safe cleanup, reconciliation, and notes are
      distinct stages.
- [ ] Worker activity is not presented as percentage progress.
- [ ] SQLite is canonical for long-term history; Prometheus retains three-day detail.
- [ ] Observability failures cannot fail workflow persistence/checkpoint/cleanup.
- [ ] Grafana alone is reachable over Tailscale HTTPS.
- [ ] Prometheus, exporters, and SQLite are not publicly or LAN-wide exposed.
- [ ] Dashboard queries use only implemented metrics and approved SQLite views.
- [ ] Container, plugin, and exporter artifacts are pinned and checksum-verified.
- [ ] Backup/restore and restart persistence are proven.
- [ ] Working-tree review includes new untracked files and excludes unrelated user work.
