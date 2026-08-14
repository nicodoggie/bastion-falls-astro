# Durable Engine-Agnostic Remote STT Design

**Date:** 2026-08-14
**Status:** Approved in conversation; awaiting written-spec review
**Scope:** Engine boundary for the durable remote-STT milestone

## Purpose

Keep the durable Bastion Falls remote-STT protocol independent of the inference
library. MLX Whisper remains the only implemented engine, but adding a future
engine such as Nemotron 3.5 ASR must not require changes to clients, SQLite job
semantics, polling, result persistence, or cleanup.

This design extends rather than replaces
`docs/superpowers/specs/2026-08-09-stereo-channel-aware-remote-stt-design.md`.
The existing channel-map, hybrid-pass, and canonical-artifact contracts remain
unchanged.

## Decision

Use a **boot-selected, registry-shaped engine layer** configured by a
machine-local YAML file.

- One named model profile is selected when the supervisor starts.
- The selected profile names exactly one engine adapter and one model.
- The initial and default registered engine is `mlx-whisper`.
- Unknown engine names fail startup with a bounded configuration error.
- There is no runtime or per-job engine fallback.
- Jobs do not carry an engine selector because engine choice is immutable for
  the lifetime of the supervisor process.
- The registry and factory make a future engine an additive adapter rather than
  a conditional branch through the supervisor.

This provides the intended future seam without implementing speculative
Nemotron dependencies, configuration, or behavior now.

## Configuration

The active configuration is machine-local operational state, not a tracked
repository file. The repository contains a non-secret example representing the
initial accepted MLX Whisper installation. Deployment for this milestone copies
or renders that example deliberately; automatic first-boot initialization is
out of scope.

- tracked example: `cli/ops/remote-stt/macos/config.example.yaml`
- active M1 file: `~/Library/Application Support/BastionWhisper/config.yaml`

The configuration shape is:

```yaml
selected_model: whisper_turbo

models:
  whisper_turbo:
    engine: mlx-whisper
    model: mlx-community/whisper-large-v3-turbo
    config: {}

  nemotron:
    engine: nemotron-asr
    model: nvidia/nemotron-3.5-asr
    config: {}
```

The Nemotron entry above illustrates the future shape only and does not belong
in the initial deployed example until that adapter exists.

Shared configuration is strict:

- `selected_model` must name one entry in `models`;
- each profile requires a stable `engine` identifier, model identifier, and
  `config` mapping;
- unknown shared keys fail startup;
- the selected engine must be registered;
- no adapter fallback is allowed.

Each engine adapter owns strict validation of its selected profile's `config`
mapping. Unknown or invalid adapter keys fail startup. Dormant profiles are
validated only for the shared shape; their engine-specific configuration is not
loaded or validated until selected. This allows a machine-local file to retain
a future profile whose adapter or libraries are not installed without importing
or initializing that adapter during current MLX operation.

Secrets must not be stored directly in this YAML file or its tracked example.
A future adapter that needs credentials must use an explicit indirect reference
whose resolution is owned by that adapter.

## Ownership Boundaries

### Durable supervisor and job runner

The engine-neutral layer owns:

- authenticated HTTP job routes;
- idempotent admission;
- SQLite job state and ordering;
- owner-only request and result files;
- restart reconciliation;
- queue execution;
- polling and result download;
- terminal deletion and bounded TTL cleanup;
- client-visible status and stable error codes.

It must not import an inference library or understand engine-specific output.

### Engine registry and factory

The composition layer owns:

- loading the bounded machine-local YAML file;
- resolving `selected_model` to its model profile;
- resolving exactly one registered engine constructor;
- validating the shared configuration and only the selected engine's adapter
  configuration;
- constructing the selected adapter without loading a model or starting a
  worker;
- failing closed when the engine is missing or invalid.

The initial registry contains only `mlx-whisper`.

### Engine adapter

An engine adapter owns:

- its worker command, environment, and working directory;
- lazy process startup and readiness checks;
- inference request forwarding or translation;
- response normalization into the engine-neutral result contract;
- idle shutdown and process-group cleanup;
- sanitized mapping of engine failures to stable error codes;
- bounded, non-secret model metadata.

The adapter interface is intentionally narrow:

- start or ensure readiness;
- execute one transcription from persisted request bytes and metadata;
- report bounded model metadata;
- stop and reap owned resources;
- perform idle reaping according to its own lifecycle.

The exact Python method names may follow repository style, but the ownership
split is normative.

## Runtime Flow

### Startup

1. Load the machine-local YAML configuration from the fixed service path.
2. Resolve `selected_model` and validate the strict shared profile shape.
3. Resolve the profile's adapter through the explicit engine registry.
4. Validate the selected profile's adapter-owned `config` mapping.
5. Construct the adapter without importing or loading heavyweight model state.
6. Open the durable job store and requeue interrupted `running` jobs.
7. Start the queue runner and cleanup loop.
8. Report supervisor readiness only after composition succeeds.

### Job execution

1. Idempotent submission persists the request before returning a durable job ID.
2. The queue runner atomically claims the next queued job.
3. The runner passes the persisted multipart bytes, content type, and a safe
   request ID to the selected adapter.
4. The adapter lazily starts its worker, waits for readiness, and performs the
   engine-specific inference call.
5. The adapter returns an engine-neutral result containing response bytes, a
   bounded media type, and an HTTP-equivalent status code.
6. The runner persists the result and marks the job terminal.
7. The client polls, downloads the result, writes canonical local transcript
   artifacts, then requests terminal job deletion.
8. Server TTL cleanup remains the fallback when client cleanup cannot finish.

### Restart

An interrupted adapter call leaves its durable job in `running`. On supervisor
startup, reconciliation returns such jobs to `queued`. The newly selected
boot-time engine processes the queue. Operators must not change engines while
retaining incompatible queued requests; the initial persisted request contract
is OpenAI-style multipart and remains the supported engine input envelope for
this milestone.

A future migration that supports engine-specific persisted inputs must add an
explicit request-envelope version rather than infer format from the selected
engine.

## Stable Contracts

This extraction must not change:

- `POST /v1/transcription-jobs`;
- `GET /v1/transcription-jobs/{id}`;
- `GET /v1/transcription-jobs/{id}/result`;
- `DELETE /v1/transcription-jobs/{id}`;
- semantic idempotency-key construction;
- SQLite job states or restart reconciliation;
- owner-only payload/result persistence;
- TypeScript client polling and local commit-before-cleanup behavior;
- canonical verbose timed-segment response bytes;
- existing synchronous OpenAI-compatible client behavior for targets not using
  the `bastion-jobs` protocol.

## Failure Semantics

The selected engine fails closed. The supervisor never falls back to another
registered or unregistered engine.

Durable failures expose stable codes only, initially including:

- `engine_start_failed`;
- `engine_unavailable`;
- `engine_inference_failed`.

Raw exception messages, tracebacks, filesystem paths, worker URLs, subprocess
output, request bodies, and upstream response bodies must not enter job status
or client-facing logs. Operational logs may include safe job IDs and fixed
engine names.

Cancellation during supervisor shutdown leaves active work recoverable through
startup reconciliation. Engine shutdown must terminate and reap only process
groups that the adapter created and owns.

## MLX Whisper Adapter

The first adapter preserves the current implementation:

- Homebrew Python and the dedicated BastionWhisper venv;
- the pinned MLX Whisper worker module;
- loopback-only worker communication;
- lazy startup and health polling;
- one active inference lane;
- configured idle unloading;
- process-group termination and direct-child reaping;
- forwarding of the persisted multipart request;
- exact worker response bytes and media type.

The extraction is structural. It must not change MLX model selection, inference
parameters, or response normalization.

## Future Nemotron Adapter

A later `nemotron-asr` registry entry may use a separate environment, packages,
worker command, readiness mechanism, and request/result translation. It must
implement the same engine adapter contract and produce the same canonical timed
segment response expected by the durable runner.

No Nemotron package, placeholder implementation, dormant worker, or untested
fallback belongs in this milestone.

## Testing

Contract-first tests must prove:

1. The initial example config parses and selects `mlx-whisper`.
2. Missing files, malformed YAML, unknown shared keys, unknown selected models,
   unknown engines, and invalid selected-adapter config fail closed before the
   HTTP service becomes ready.
3. Dormant profiles do not import or validate unselected engine adapters.
4. Import and composition do not start a worker or load a model.
5. The durable runner invokes only the adapter contract, not MLX-specific
   process or HTTP details.
6. Existing MLX command, environment, readiness, single-flight, idle-reaping,
   cancellation, and process-group ownership behavior remains intact.
7. Adapter failures become bounded durable error codes without raw details.
8. Existing durable routes, idempotency, payload persistence, restart
   reconciliation, and response bytes remain unchanged.
9. The current M1 service passes a real durable transcription after deployment.

Verification includes focused Python contract tests, the complete remote-STT
Python suite in the Mac service environment, CLI tests, TypeScript typecheck,
CLI build, formatting/lint checks relevant to touched files, `git diff --check`,
and one live cold/warm lifecycle request.

## Deployment

Deploy the tracked example, engine module, job store, and supervisor together as
one service revision. Deliberately create the initial machine-local active
configuration from the example if it does not exist; do not overwrite an
existing active configuration implicitly. Compile the Python modules in the M1
service environment before replacing active files. Preserve recoverable
backups, restart the existing user-domain LaunchAgent, verify cold supervisor
health without loading the model, then run a real durable request.

The selected model profile remains the initial MLX Whisper profile. No engine
switch is part of this deployment.

## Out of Scope

- implementing or installing Nemotron 3.5 ASR;
- automatic bootstrapping or first-boot generation of the active config;
- overwriting or migrating an existing machine-local config automatically;
- selecting engines per job;
- running multiple engines concurrently;
- engine fallback or automatic quality comparison;
- changing the public durable-job protocol;
- changing channel-map or hybrid alignment semantics;
- changing model parameters or transcript correction behavior.
