# Durable Engine-Agnostic Remote STT Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Finish the durable remote-STT protocol and place MLX Whisper behind a boot-selected, YAML-configured engine adapter so a future Nemotron adapter can be added without changing clients, SQLite jobs, or durable result semantics.

**Architecture:** A strict machine-local YAML file selects one named model profile. A lazy registry constructs exactly one adapter; the durable supervisor owns HTTP and SQLite while the selected adapter owns process lifecycle, readiness, inference transport, and bounded engine failures. The existing TypeScript `bastion-jobs` transport and canonical local artifact flow remain unchanged.

**Tech Stack:** Python 3.13, FastAPI, httpx, PyYAML 6.0.3, SQLite, `unittest`, TypeScript, Zod, Undici, pnpm.

**Source design:** `docs/superpowers/specs/2026-08-14-durable-engine-agnostic-remote-stt-design.md`

**Execution constraint:** Preserve the dirty worktree and do not commit unless Nico explicitly asks. The commit steps normally prescribed by the planning workflow are intentionally replaced by scoped `git diff` and status checkpoints.

---

### Task 1: Add the strict model-profile configuration contract

**Objective:** Parse a bounded machine-local YAML document, resolve `selected_model`, and preserve adapter-owned `config` as an unvalidated mapping until the selected adapter receives it.

**Files:**

- Create: `cli/ops/remote-stt/macos/service_config.py`
- Create: `cli/ops/remote-stt/macos/config.example.yaml`
- Create: `cli/ops/remote-stt/macos/test_service_config.py`

**Step 1: Write failing configuration tests**

Cover these contracts in `test_service_config.py`:

```python
class ServiceConfigTests(unittest.TestCase):
    def test_example_selects_the_mlx_whisper_profile(self): ...
    def test_rejects_missing_or_oversized_config(self): ...
    def test_rejects_malformed_yaml_and_non_mapping_root(self): ...
    def test_rejects_unknown_shared_keys(self): ...
    def test_rejects_unknown_selected_model(self): ...
    def test_preserves_dormant_adapter_config_without_loading_it(self): ...
```

The accepted shared shape is exact:

```yaml
selected_model: whisper_turbo
models:
  whisper_turbo:
    engine: mlx-whisper
    model: mlx-community/whisper-large-v3-turbo
    config: {}
```

Bound the file before parsing (64 KiB), require owner-readable regular-file input, restrict profile/engine IDs to a conservative identifier regex, cap model count and mapping sizes, and reject YAML aliases/custom objects through `yaml.safe_load` plus explicit primitive-shape validation.

**Step 2: Run RED**

Run on the M1 service interpreter because PyYAML is an operational dependency:

```bash
scp cli/ops/remote-stt/macos/test_service_config.py ensu-macos:/tmp/bastion-job-test/
ssh ensu-macos 'cd /tmp/bastion-job-test && \
  "$HOME/Library/Application Support/BastionWhisper/venv/bin/python" \
  -m unittest -v test_service_config.py'
```

Expected: FAIL because `service_config` does not exist.

**Step 3: Implement the minimal parser**

Expose immutable value objects and one loader:

```python
@dataclass(frozen=True)
class ModelProfile:
    name: str
    engine: str
    model: str
    config: dict[str, object]

@dataclass(frozen=True)
class ServiceConfig:
    selected_model: str
    models: dict[str, ModelProfile]

    @property
    def selected(self) -> ModelProfile: ...


def load_service_config(path: Path) -> ServiceConfig: ...
```

Do not import `engines`, inspect installed libraries, resolve secrets, or validate adapter-specific keys here. Return detached dictionaries so YAML-owned mutable aliases cannot change the validated object graph.

**Step 4: Run GREEN**

Run the focused M1 command again. Expected: all configuration tests pass without warnings.

**Step 5: Check the scoped diff**

```bash
git diff --check -- \
  cli/ops/remote-stt/macos/service_config.py \
  cli/ops/remote-stt/macos/config.example.yaml \
  cli/ops/remote-stt/macos/test_service_config.py
```

Do not commit.

---

### Task 2: Define the engine protocol and fail-closed lazy registry

**Objective:** Introduce an engine-neutral runtime contract and resolve only the selected adapter.

**Files:**

- Create: `cli/ops/remote-stt/macos/engines/__init__.py`
- Create: `cli/ops/remote-stt/macos/engines/base.py`
- Create: `cli/ops/remote-stt/macos/engines/registry.py`
- Create: `cli/ops/remote-stt/macos/test_engine_registry.py`

**Step 1: Write failing protocol/registry tests**

Test:

- `mlx-whisper` resolves to one registered factory;
- unknown selected engines raise `EngineConfigurationError` with a fixed bounded message;
- resolving an unknown engine never falls back to MLX;
- importing `base` or `registry` does not import `engines.mlx_whisper`, start a subprocess, or import an ML library;
- a dormant unregistered profile is harmless until selected.

Use a fresh subprocess for import-isolation proof rather than relying on order-sensitive `sys.modules` state.

**Step 2: Run RED**

```bash
python -m unittest -v cli/ops/remote-stt/macos/test_engine_registry.py
```

Expected: FAIL because the engine package does not exist. If local Python lacks runtime dependencies, run the same file in `/tmp/bastion-job-test` on `ensu-macos` and record that environment explicitly.

**Step 3: Implement the narrow contract**

`engines/base.py` should define shapes equivalent to:

```python
@dataclass(frozen=True)
class EngineResult:
    content: bytes
    status_code: int
    media_type: str | None
    process_time_ms: str | None = None

class EngineError(Exception):
    code: Literal[
        "engine_start_failed",
        "engine_unavailable",
        "engine_inference_failed",
    ]

class InferenceEngine(Protocol):
    name: str
    model: str

    @property
    def running(self) -> bool: ...

    @property
    def active_requests(self) -> int: ...

    async def transcribe(
        self,
        *,
        payload: bytes,
        content_type: str,
        request_id: str,
    ) -> EngineResult: ...

    async def stop(self) -> None: ...
    async def reap_loop(self) -> None: ...
```

Keep exception strings fixed and do not retain raw provider exceptions through `__cause__` or `__context__` when translating expected adapter failures.

`engines/registry.py` should store lazy module/factory references, import only the selected entry, validate the constructor result against the protocol contract, and expose one `create_engine(profile, service_root)` function. The initial registry contains only `mlx-whisper`.

**Step 4: Run GREEN and import smoke**

```bash
python -m unittest -v cli/ops/remote-stt/macos/test_engine_registry.py
python -c 'import sys; sys.path.insert(0, "cli/ops/remote-stt/macos"); import engines.registry; assert "engines.mlx_whisper" not in sys.modules'
```

Expected: tests pass; the assertion succeeds.

**Step 5: Check scoped diff; do not commit**

---

### Task 3: Extract the existing MLX process lifecycle into its adapter

**Objective:** Move current worker startup, readiness, single-flight reservation, inference forwarding, idle unload, and owned shutdown behind `MlxWhisperEngine` without changing runtime behavior.

**Files:**

- Create: `cli/ops/remote-stt/macos/engines/mlx_whisper.py`
- Create: `cli/ops/remote-stt/macos/test_mlx_whisper_engine.py`
- Modify later, not yet: `cli/ops/remote-stt/macos/supervisor.py`

**Step 1: Move the existing lifecycle tests to adapter-facing RED tests**

Adapt the current `WorkerManagerTests` into `test_mlx_whisper_engine.py`. Prove:

- strict adapter config accepts `{}` and the supported bounded options;
- unknown config keys and bool-as-int values fail closed;
- the profile's `model` becomes the adapter model metadata;
- construction is cold and starts no subprocess;
- concurrent calls start the worker once and reject duplicate inference;
- startup uses the existing venv, app root, uvicorn module, loopback host, and configured worker port;
- readiness polling remains bounded;
- worker startup failure is translated to `engine_start_failed` without raw details;
- inference transport failure becomes `engine_inference_failed`;
- `EngineResult` preserves exact bytes, status, media type, and optional process-time header;
- idle reaping does not stop active work;
- shutdown sends TERM, waits, escalates to KILL after the existing grace period, and reaps the direct child;
- process creation retains the current launchd parent-job lifecycle and does not introduce an independent session.

**Step 2: Run RED**

Run the focused adapter test in the M1 venv. Expected: FAIL because `engines.mlx_whisper` does not exist.

**Step 3: Implement `MlxWhisperEngine`**

Move—not duplicate—the behavior currently in `WorkerManager`. Keep supported config deliberately small:

```yaml
config:
  worker_port: 8001
  idle_seconds: 300
  start_timeout_seconds: 90
```

All fields are optional with current defaults. Runtime paths and `app.main:app` remain adapter-owned constants relative to `service_root`; they are not configurable in this milestone. The shared profile `model` replaces `STT_MODEL` for metadata and logging.

`transcribe()` must own reservation and release internally:

```python
async def transcribe(...):
    await self._acquire(request_id)
    try:
        # exact persisted multipart body forwarded to the existing worker
        return EngineResult(...)
    finally:
        await self._release()
```

Do not parse multipart data in the adapter, change request fields, or normalize worker JSON.

**Step 4: Run GREEN**

Run `test_mlx_whisper_engine.py` with warnings treated as errors. Expected: all lifecycle tests pass and no task/process/resource warning appears.

**Step 5: Check scoped diff; do not commit**

---

### Task 4: Compose the selected engine and route durable jobs through it

**Objective:** Make the supervisor engine-neutral while preserving every public HTTP and SQLite contract.

**Files:**

- Modify: `cli/ops/remote-stt/macos/supervisor.py`
- Modify: `cli/ops/remote-stt/macos/test_supervisor.py`
- Test: `cli/ops/remote-stt/macos/test_job_store.py`

**Step 1: Write failing composition and runner tests**

Replace MLX-specific manager mocks with an `InferenceEngine` fake. Assert:

- lifespan loads the fixed `SERVICE_ROOT / "config.yaml"` path;
- invalid configuration or unknown selected engine fails before runner tasks start;
- composition and `/health` do not start/load the engine;
- health reports selected profile/model plus `engine_loaded` from adapter state, with no paths/config/secrets;
- `JobRunner._execute()` calls only `engine.transcribe(payload, content_type, request_id)`;
- exact `EngineResult` bytes/status/media type are persisted;
- `EngineError.code` is persisted exactly;
- unexpected exceptions become `engine_inference_failed`, with a raw-marker assertion proving the job record and response contain no exception detail;
- cancellation leaves the claimed job recoverable through existing reconciliation;
- the legacy synchronous endpoint, retained for compatibility, uses the adapter and preserves disconnect recycling plus HTTP behavior.

Route assertions must key routes by `(method, path)` so GET and DELETE on the same job path cannot mask each other.

**Step 2: Run RED**

Run `test_supervisor.py` in `/tmp/bastion-job-test` on the M1. Expected: runner tests fail because they still depend on `WorkerManager` and `WORKER_URL`.

**Step 3: Implement the minimal supervisor migration**

- Remove `MODEL`, `WORKER_PORT`, `WORKER_URL`, and `WorkerManager` from `supervisor.py`.
- Keep service-wide job root, TTL, request size, API authentication, and durable routes in the supervisor.
- In lifespan, load config, create exactly one selected engine, reconcile jobs, then start runner/reaper tasks.
- Give `JobRunner` an `InferenceEngine`, not a manager.
- Keep adapter startup cold until the first inference.
- Cancel and await runner/reaper tasks before stopping the adapter.
- Use fixed bounded operational logs; do not call `logger.exception` with raw adapter failures.

**Step 4: Run GREEN with the full Python group**

```bash
ssh ensu-macos 'cd /tmp/bastion-job-test && PYTHONWARNINGS=error::ResourceWarning \
  "$HOME/Library/Application Support/BastionWhisper/venv/bin/python" \
  -m unittest -v test_service_config.py test_engine_registry.py \
  test_mlx_whisper_engine.py test_job_store.py test_supervisor.py'
```

Expected: all tests pass without warnings.

**Step 5: Compile and import-smoke**

```bash
python -m py_compile \
  cli/ops/remote-stt/macos/service_config.py \
  cli/ops/remote-stt/macos/job_store.py \
  cli/ops/remote-stt/macos/engines/*.py \
  cli/ops/remote-stt/macos/supervisor.py
```

Expected: zero output and exit 0.

---

### Task 5: Lock the TypeScript transport and local commit-before-cleanup behavior

**Objective:** Confirm the already implemented durable client remains engine-agnostic and that local canonical artifacts commit before remote deletion.

**Files:**

- Modify only if a gap is found: `cli/src/commands/transcribe/openAiStt.test.ts`
- Modify only if a gap is found: `cli/src/commands/transcribe/pipeline.test.ts`
- Preserve: `cli/src/commands/transcribe/openAiStt.ts`
- Preserve: `cli/src/commands/transcribe/pipeline.ts`
- Preserve: `cli/src/commands/transcribe/settings.ts`

**Step 1: Add the missing ordering regression if necessary**

The current tests prove submit/poll/result/delete and stable idempotency after a lost submission response. Add one pipeline-level test that records events and asserts:

```text
remote result -> JSON write -> Markdown write -> checkpoint write -> DELETE cleanup
```

A cleanup failure after local commit must emit the bounded TTL fallback progress message and retain successful local completion.

**Step 2: Run focused RED/GREEN**

```bash
pnpm -F @bastion-falls/cli exec tsx --test \
  src/commands/transcribe/openAiStt.test.ts \
  src/commands/transcribe/pipeline.test.ts \
  src/commands/transcribe/settings.test.ts
pnpm -F @bastion-falls/cli typecheck
```

If the existing suite already proves the full ordering contract, do not add redundant tests; record the exact existing assertion instead.

**Step 3: Verify transport preservation**

Assert no model-engine selector is added to job routes or idempotency identity. The client sends model profile data only through the existing multipart `model` field; engine selection remains server boot configuration.

**Step 4: Check scoped diff; do not commit**

---

### Task 6: Update operational artifacts for machine-local configuration

**Objective:** Make deployment reproducible without making the active config repository-owned or implementing automatic bootstrap.

**Files:**

- Modify: `cli/ops/remote-stt/macos/com.bastion-falls.whisper.plist`
- Modify: `cli/ops/remote-stt/README.md`
- Preserve/create: `cli/ops/remote-stt/macos/config.example.yaml`

**Step 1: Write/check operational contract assertions**

Add focused source assertions where useful:

- plist no longer sets `STT_MODEL`, `WORKER_PORT`, or `MODEL_IDLE_SECONDS`;
- plist retains `HF_HOME`, loopback supervisor bind, `Umask`, and service paths;
- README distinguishes tracked example from machine-local active config;
- install instructions copy the `engines/` package and supporting modules;
- install instructions create active config only when absent and never overwrite it implicitly;
- no secret-bearing value appears in the example.

**Step 2: Modify plist and README**

Keep `API_KEY` handling unchanged. Do not move credentials into YAML. Document automatic first-boot config generation as out of scope, not as an unimplemented command.

**Step 3: Validate artifacts**

```bash
plutil -lint cli/ops/remote-stt/macos/com.bastion-falls.whisper.plist
python -c 'import sys; sys.path.insert(0, "cli/ops/remote-stt/macos"); from service_config import load_service_config; print(load_service_config(__import__("pathlib").Path("cli/ops/remote-stt/macos/config.example.yaml")).selected.name)'
git diff --check -- cli/ops/remote-stt
```

Run `plutil` on `ensu-macos` if unavailable on Linux.

---

### Task 7: Run complete local verification

**Objective:** Prove the Python service and TypeScript CLI are internally green before touching the live M1 service.

**Files:** No new files expected.

**Step 1: Run the complete Mac Python suite**

Stage only source/test files into a private `/tmp/bastion-job-test` directory and run all remote-STT tests with resource warnings as errors.

Expected: all tests pass; no model worker starts during config/registry/import tests.

**Step 2: Run CLI gates**

```bash
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
pnpm -F @bastion-falls/cli lint
pnpm -F @bastion-falls/cli fmt
```

Do not run a formatter that rewrites unrelated dirty files. If `fmt` is check-only, run it; otherwise use changed-file formatting/readback and report the limitation.

**Step 3: Run repository diff checks**

```bash
git diff --check
git status --short --branch
git diff -- \
  cli/ops/remote-stt \
  cli/src/commands/transcribe/openAiStt.ts \
  cli/src/commands/transcribe/openAiStt.test.ts \
  cli/src/commands/transcribe/pipeline.ts \
  cli/src/commands/transcribe/pipeline.test.ts \
  cli/src/commands/transcribe/settings.ts \
  cli/src/commands/transcribe/settings.test.ts \
  astro/.bfcli.yml
```

Verify unrelated corrections and world-note files remain untouched.

---

### Task 8: Deploy transactionally and exercise a real durable request

**Objective:** Replace the live service safely, verify cold boot, idempotent durable execution, persisted result retrieval, and cleanup.

**Files deployed:**

- `supervisor.py`
- `job_store.py`
- `service_config.py`
- `engines/`
- `config.example.yaml`
- plist only if its source changed

**Step 1: Preflight live state without exposing secrets**

Check LaunchAgent status, supervisor health, worker listener absence/presence, existing active config existence/mode, and exact destination paths. Do not print active YAML if it could later contain private options.

**Step 2: Stage a unique revision and compile it remotely**

Upload to a unique owner-only staging directory, copy the existing active service files to a recoverable backup, and run the service venv's `py_compile` plus config parser against a staged active config.

If no active `config.yaml` exists, create it from `config.example.yaml` with mode `0600`. If it exists, fail closed and inspect compatibility before any replacement; never overwrite it automatically.

**Step 3: Atomically publish and restart**

Replace the Python modules/package as one revision, validate plist, then kickstart `user/$(id -u)/com.bastion-falls.whisper`. On failure, restore the complete prior revision and restart it.

**Step 4: Verify cold supervisor behavior**

- `/health` returns selected model/engine metadata;
- worker port 8001 remains absent;
- supervisor remains stable across a bounded observation window;
- no raw configuration or paths appear in health output.

**Step 5: Submit one real durable job**

Use a bounded existing 30-second FLAC fixture and a generated semantic idempotency key:

1. `POST /v1/transcription-jobs` returns 202 quickly.
2. Repeat the same POST and assert the same job ID with `created: false`.
3. Poll until terminal.
4. Download exact JSON result and validate timed segments.
5. Confirm the result remains downloadable before cleanup.
6. Delete the terminal job and assert later status/result return 404.
7. Confirm worker idle unload still occurs after the configured interval.

Do not log or print credentials, complete transcript text, or raw request bodies as evidence.

**Step 6: Exercise restart reconciliation**

For a bounded test job, restart the supervisor only after the job reaches `running`, then verify the same durable job ID returns to queued/running and eventually succeeds. Do not kill the M1 itself or interrupt unrelated local services.

**Step 7: Verify cleanup**

Confirm no staging/backup marker remains after success, active config mode is owner-only, SQLite/files exist only under the intended state root, and the llama.cpp router PID remains unchanged.

---

### Task 9: Resume the August 9 transcription

**Objective:** Continue the real stereo-channel-map workload from its durable checkpoint after the service acceptance gate succeeds.

**Files:** Existing transcription artifacts/checkpoint only; discover exact paths before acting.

**Step 1: Re-read the checkpoint and artifacts**

Use the current checkpoint and valid artifact-pair checks to confirm left chunk 35 is still the first incomplete selected unit. Do not infer this solely from session history.

**Step 2: Resume through the local CLI**

Run the existing `m1-hybrid-test` profile with the same source, channel map, selection, language, prompt, and resume semantics recovered from the checkpoint/previous command. Do not use `--force` unless the checkpoint proves rebuild is required.

**Step 3: Verify every completed unit**

After each chunk, confirm canonical JSON, Markdown, and checkpoint completion landed locally before its remote job disappeared. If interrupted, rerun normally and confirm semantic idempotency attaches to the retained remote job.

**Step 4: Report bounded progress**

Report completed pass/chunk counts, first remaining unit, service/job status, and any blocker. Do not claim the entire August 9 transcription complete unless all required passes and downstream stages actually validate.

---

## Final Completion Evidence

Completion requires fresh evidence for:

- strict config RED/GREEN;
- lazy registry/import isolation RED/GREEN;
- MLX lifecycle adapter RED/GREEN;
- engine-neutral durable runner RED/GREEN;
- complete Mac Python suite;
- complete CLI tests, typecheck, build, lint, and applicable format check;
- `git diff --check`;
- live cold supervisor proof;
- duplicate-submit same-job proof;
- restart reconciliation of the same durable job ID;
- result persistence before deletion and 404 after cleanup;
- resumed August 9 checkpoint progress.

No commit or push is part of this plan unless Nico asks explicitly.
