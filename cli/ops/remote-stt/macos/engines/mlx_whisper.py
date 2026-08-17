"""Lazy MLX Whisper worker adapter."""

from __future__ import annotations

import asyncio
import math
import os
import time
from collections.abc import Awaitable, Mapping
from pathlib import Path
from typing import Any

import httpx

from .base import EngineError, EngineResult
from .registry import EngineConfigurationError


class MlxWhisperEngine:
    name = "mlx-whisper"

    def __init__(self, profile: Any, service_root: Path) -> None:
        self.model = profile.model
        self.service_root = Path(service_root)
        self.app_root = self.service_root / "app"
        self.python = self.service_root / "venv" / "bin" / "python"
        self.host = "127.0.0.1"
        self.worker_port, self.idle_seconds, self.start_timeout_seconds = _parse_config(
            profile.config
        )
        self.process: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()
        self.active_request_id: str | None = None
        self.last_used = time.monotonic()

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    @property
    def active_requests(self) -> int:
        return int(self.active_request_id is not None)

    @property
    def worker_url(self) -> str:
        return f"http://{self.host}:{self.worker_port}"

    async def start(self) -> None:
        async with self.lock:
            await self._start_locked()

    async def _start_locked(self) -> None:
        if self.running:
            return
        env = os.environ.copy()
        env.update({"HOST": self.host, "PORT": str(self.worker_port), "STT_MODEL": self.model})
        cancelled = False
        failed = False
        try:
            self.process = await asyncio.create_subprocess_exec(
                str(self.python),
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                self.host,
                "--port",
                str(self.worker_port),
                "--workers",
                "1",
                cwd=str(self.app_root),
                env=env,
            )
            deadline = time.monotonic() + self.start_timeout_seconds
            async with httpx.AsyncClient(timeout=1) as client:
                while time.monotonic() < deadline:
                    if self.process.returncode is not None:
                        raise RuntimeError("worker exited during startup")
                    try:
                        response = await client.get(f"{self.worker_url}/health")
                        if response.status_code == 200:
                            self.last_used = time.monotonic()
                            return
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.25)
            raise TimeoutError("worker readiness timeout")
        except asyncio.CancelledError:
            cancelled = True
        except Exception:
            failed = True
        await self._stop_locked()
        if cancelled:
            raise asyncio.CancelledError
        if failed:
            raise _start_error()

    async def _acquire(self, request_id: str) -> None:
        async with self.lock:
            if self.active_request_id is not None:
                raise _inference_error()
            await self._start_locked()
            if not self.running:
                raise _inference_error()
            self.active_request_id = request_id
            self.last_used = time.monotonic()

    async def _release(self) -> None:
        async with self.lock:
            self.active_request_id = None
            self.last_used = time.monotonic()

    async def transcribe(self, *, payload: bytes, content_type: str, request_id: str) -> EngineResult:
        await self._acquire(request_id)
        cancelled = False
        failed = False
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                response = await client.post(
                    f"{self.worker_url}/v1/audio/transcriptions",
                    content=payload,
                    headers={
                        "content-type": content_type,
                        "x-bastion-request-id": request_id,
                    },
                )
            return EngineResult(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get("content-type"),
                process_time_ms=response.headers.get("x-process-time-ms"),
            )
        except asyncio.CancelledError:
            cancelled = True
        except Exception:
            failed = True
        finally:
            cancelled = await _await_cleanup(self._release()) or cancelled
        if cancelled:
            raise asyncio.CancelledError
        if failed:
            raise _inference_error()
        raise AssertionError("unreachable")

    async def stop(self) -> None:
        async with self.lock:
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        process = self.process
        if process is None:
            return
        cancelled = await _await_cleanup(self._stop_process(process))
        if self.process is process:
            self.process = None
        if cancelled:
            raise asyncio.CancelledError

    async def _stop_process(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(process.wait(), timeout=20)
        except (asyncio.TimeoutError, TimeoutError):
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()


    async def reap_loop(self) -> None:
        while True:
            await asyncio.sleep(min(5, max(1, self.idle_seconds / 4)))
            async with self.lock:
                if (
                    self.running
                    and self.active_request_id is None
                    and time.monotonic() - self.last_used >= self.idle_seconds
                ):
                    await self._stop_locked()


async def _await_cleanup(awaitable: Awaitable[None]) -> bool:
    """Settle one cleanup operation despite repeated owner cancellation."""
    task = asyncio.ensure_future(awaitable)
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    task.result()
    return cancelled


def _start_error() -> EngineError:
    return EngineError("engine_start_failed")


def _inference_error() -> EngineError:
    return EngineError("engine_inference_failed")


def _parse_config(config: Mapping[str, object]) -> tuple[int, float, float]:
    if not isinstance(config, Mapping) or any(key not in {"worker_port", "idle_seconds", "start_timeout_seconds"} for key in config):
        raise EngineConfigurationError("Invalid mlx-whisper configuration")
    port = config.get("worker_port", 8001)
    idle = config.get("idle_seconds", 300)
    timeout = config.get("start_timeout_seconds", 90)
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise EngineConfigurationError("Invalid mlx-whisper configuration")
    idle_value = _positive_number(idle, 86400)
    timeout_value = _positive_number(timeout, 600)
    return port, idle_value, timeout_value


def _positive_number(value: object, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EngineConfigurationError("Invalid mlx-whisper configuration")
    numeric = float(value)
    if not math.isfinite(numeric) or numeric <= 0 or numeric > maximum:
        raise EngineConfigurationError("Invalid mlx-whisper configuration")
    return numeric


def create_engine(profile: Any, service_root: Path) -> MlxWhisperEngine:
    return MlxWhisperEngine(profile, service_root)
