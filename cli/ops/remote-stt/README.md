# Remote M1 STT operations

This directory records the private operational layer behind the opt-in
`m1-hybrid-test` transcription profile. Whisper inference runs on
`ensu-macos`; Linux retains audio preparation and transcript orchestration but
does not load the model.

## Runtime shape

```text
bfcli -> 127.0.0.1:18000
          Linux systemd --user SSH tunnel
            -> ensu-macos 127.0.0.1:8000
                 launchd supervisor (~55-65 MiB idle)
                   -> on-demand MLX worker 127.0.0.1:8001
```

The supervisor keeps health and model discovery cold. It persists accepted jobs
in SQLite with owner-only request and result files, then runs one queued
inference at a time. Interrupted running jobs return to the queue on supervisor
startup. After 300 seconds with no active requests, the worker process group
exits so macOS can reclaim the model's unified memory. The Hugging Face cache
remains on disk.

The Bastion client submits to `POST /v1/transcription-jobs`, polls
`GET /v1/transcription-jobs/{id}`, downloads the result, writes its canonical
local artifacts, then requests job deletion. Repeated submissions with the same
`X-Idempotency-Key` return the original job. A bounded server TTL cleans up
terminal jobs if client cleanup cannot complete.

Both public-facing listeners bind to loopback. No API key or SSH credential is
stored in this repository.

## Pinned installation

The accepted Mac installation uses:

- service root: `~/Library/Application Support/BastionWhisper`
- application commit: `7d553377a851234536e04aa3db4f5e5ef8d2799f`
- Python: Homebrew 3.13
- `mlx==0.32.0`
- `mlx-whisper==0.4.3`
- `fastapi==0.141.1`
- `uvicorn==0.52.1`
- model: `mlx-community/whisper-large-v3-turbo`
- launchd label: `com.bastion-falls.whisper`
- Linux unit: `bastion-whisper-tunnel.service`

The supervisor and worker both enforce a 64 MiB request limit. The worker also
includes bounded compatibility fixes required by real Bastion Falls chunks:
omission of non-finite optional metrics and logged removal of reversed-time
segments rather than invented timestamps.

## Install or refresh the Mac supervisor

Copy `macos/supervisor.py` and `macos/job_store.py` into the service root and the plist into
`~/Library/LaunchAgents/`. Preserve any previous plist before replacing it.
The worker application and dedicated venv must already exist beneath the
service root.

Validate and register over the proven user launchd domain:

```bash
python -m py_compile macos/supervisor.py macos/job_store.py
ssh ensu-macos 'plutil -lint "$HOME/Library/LaunchAgents/com.bastion-falls.whisper.plist"'
ssh ensu-macos 'launchctl bootstrap "user/$(id -u)" "$HOME/Library/LaunchAgents/com.bastion-falls.whisper.plist"'
ssh ensu-macos 'launchctl kickstart -k "user/$(id -u)/com.bastion-falls.whisper"'
```

A `gui/<uid>` domain may not exist during SSH-only operation; use
`user/<uid>`. Inspect with:

```bash
ssh ensu-macos 'launchctl print "user/$(id -u)/com.bastion-falls.whisper"'
```

## Install the Linux tunnel

The SSH alias `ensu-macos` must support noninteractive public-key access.
Install and validate the repository unit:

```bash
install -Dm600 \
  cli/ops/remote-stt/linux/bastion-whisper-tunnel.service \
  "$HOME/.config/systemd/user/bastion-whisper-tunnel.service"
systemd-analyze --user verify \
  "$HOME/.config/systemd/user/bastion-whisper-tunnel.service"
systemctl --user daemon-reload
systemctl --user enable --now bastion-whisper-tunnel.service
```

The user manager has linger enabled on the accepted Linux host, so this tunnel
can recover independently of an interactive terminal. Verify:

```bash
systemctl --user is-enabled bastion-whisper-tunnel.service
systemctl --user is-active bastion-whisper-tunnel.service
curl --fail --silent --show-error http://127.0.0.1:18000/health
```

Restarting the tunnel must not restart or load the Mac model worker.

## Acceptance evidence

The accepted lifecycle used a real 30-second session slice:

- cold request including model load: about 9.1 seconds
- warm request: about 4.3 seconds
- worker while loaded: about 1.84 GiB RSS
- supervisor-only idle floor: about 54-62 MiB RSS
- worker absent after 315 seconds
- reload request: about 9.1 seconds with equivalent output
- LaunchAgent kickstart changed the supervisor PID and returned cold/healthy
- the existing Mac llama.cpp router kept the same PID throughout

A Python `resource_tracker` semaphore warning can appear when MLX exits. Keep
it visible, but judge reclamation by worker PID/listener absence and
supervisor-only RSS.

## Troubleshooting

- `ensu-macos` is an SSH-config alias, not an HTTP DNS name.
- Noninteractive macOS SSH omits Homebrew from `PATH`; use explicit
  `/opt/homebrew` paths or the plist environment.
- Health and `/v1/models` must not start port 8001.
- If first inference returns 503, inspect
  `~/Library/Logs/BastionWhisper/stderr.log` for worker path/startup failures.
- If Linux port 18000 is absent, inspect
  `journalctl --user -u bastion-whisper-tunnel.service` and confirm
  `ssh -o BatchMode=yes ensu-macos true` succeeds.
