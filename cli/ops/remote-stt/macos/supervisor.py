import asyncio
import logging
import os
import signal
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("bastion_whisper.supervisor")

MODEL = os.getenv("STT_MODEL", "mlx-community/whisper-large-v3-turbo")
WORKER_HOST = "127.0.0.1"
WORKER_PORT = int(os.getenv("WORKER_PORT", "8001"))
IDLE_SECONDS = int(os.getenv("MODEL_IDLE_SECONDS", "300"))
START_TIMEOUT_SECONDS = float(os.getenv("WORKER_START_TIMEOUT_SECONDS", "90"))
MAX_REQUEST_BYTES = 64 * 1024 * 1024
SERVICE_ROOT = Path(__file__).resolve().parent
APP_ROOT = SERVICE_ROOT / "app"
PYTHON = SERVICE_ROOT / "venv" / "bin" / "python"
WORKER_URL = f"http://{WORKER_HOST}:{WORKER_PORT}"
API_KEY = os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY")


class RequestTooLargeError(Exception):
    pass


async def read_request_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            raise RequestTooLargeError
        body.extend(chunk)
    return bytes(body)


class WorkerManager:
    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()
        self.active_requests = 0
        self.last_used = time.monotonic()
        self.reaper_task: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    async def start(self) -> None:
        async with self.lock:
            await self._start_locked()

    async def _start_locked(self) -> None:
        if self.running:
            return
        env = os.environ.copy()
        env.update({"HOST": WORKER_HOST, "PORT": str(WORKER_PORT)})
        logger.info(
            "Starting Whisper worker for %s with %s in %s",
            MODEL,
            PYTHON,
            APP_ROOT,
        )
        self.process = await asyncio.create_subprocess_exec(
            str(PYTHON),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            WORKER_HOST,
            "--port",
            str(WORKER_PORT),
            "--workers",
            "1",
            cwd=str(APP_ROOT),
            env=env,
            start_new_session=True,
        )
        deadline = time.monotonic() + START_TIMEOUT_SECONDS
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                while time.monotonic() < deadline:
                    if self.process.returncode is not None:
                        raise RuntimeError(
                            f"Whisper worker exited during startup with status {self.process.returncode}"
                        )
                    try:
                        response = await client.get(f"{WORKER_URL}/health")
                        if response.status_code == 200:
                            self.last_used = time.monotonic()
                            logger.info("Whisper worker is ready (pid=%s)", self.process.pid)
                            return
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.25)
            raise TimeoutError("Whisper worker did not become ready in time")
        except BaseException:
            await self._stop_locked()
            raise

    async def acquire(self) -> None:
        async with self.lock:
            await self._start_locked()
            if not self.running:
                raise RuntimeError("Whisper worker stopped before request dispatch")
            self.active_requests += 1

    async def release(self) -> None:
        async with self.lock:
            self.active_requests = max(0, self.active_requests - 1)
            self.last_used = time.monotonic()

    async def stop(self) -> None:
        async with self.lock:
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        process = self.process
        self.process = None
        if process is None or process.returncode is not None:
            return
        logger.info("Stopping idle Whisper worker (pid=%s)", process.pid)
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), timeout=20)
        except TimeoutError:
            logger.warning("Whisper worker did not stop gracefully; killing it")
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()
        logger.info("Whisper worker stopped")

    async def reap_loop(self) -> None:
        while True:
            await asyncio.sleep(min(5, max(1, IDLE_SECONDS / 4)))
            async with self.lock:
                idle_for = time.monotonic() - self.last_used
                if self.running and self.active_requests == 0 and idle_for >= IDLE_SECONDS:
                    await self._stop_locked()


manager = WorkerManager()
_start_time = time.time()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    manager.reaper_task = asyncio.create_task(manager.reap_loop())
    try:
        yield
    finally:
        if manager.reaper_task:
            manager.reaper_task.cancel()
        await manager.stop()


app = FastAPI(title="Bastion Whisper On-Demand Supervisor", lifespan=lifespan)


@app.middleware("http")
async def authenticate(request: Request, call_next):
    if API_KEY and request.url.path.startswith("/v1/"):
        if request.headers.get("authorization", "") != f"Bearer {API_KEY}":
            return JSONResponse(
                status_code=401,
                content={"error": {"message": "Invalid API key", "type": "invalid_request_error"}},
            )
    return await call_next(request)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": MODEL,
        "model_loaded": manager.running,
        "idle_timeout_seconds": IDLE_SECONDS,
        "active_requests": manager.active_requests,
        "uptime_seconds": round(time.time() - _start_time, 1),
    }


@app.get("/v1/models")
async def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": "whisper-1",
                "object": "model",
                "created": int(_start_time),
                "owned_by": "local",
            }
        ],
    }


@app.api_route(
    "/v1/audio/transcriptions",
    methods=["POST"],
)
async def transcribe(request: Request):
    try:
        body = await read_request_body(request)
        await manager.acquire()
        try:
            headers = {
                key: value
                for key, value in request.headers.items()
                if key.lower() not in {"host", "content-length"}
            }
            async with httpx.AsyncClient(timeout=None) as client:
                upstream = await client.post(
                    f"{WORKER_URL}/v1/audio/transcriptions",
                    content=body,
                    headers=headers,
                )
            response_headers = {}
            if process_time := upstream.headers.get("x-process-time-ms"):
                response_headers["X-Worker-Process-Time-Ms"] = process_time
            return Response(
                content=upstream.content,
                status_code=upstream.status_code,
                headers=response_headers,
                media_type=upstream.headers.get("content-type"),
            )
        finally:
            await manager.release()
    except RequestTooLargeError:
        return JSONResponse(
            status_code=413,
            content={
                "error": {
                    "message": "Request body exceeds the 64 MiB limit",
                    "type": "invalid_request_error",
                }
            },
        )
    except Exception:
        logger.exception("Whisper worker request failed")
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Whisper worker unavailable", "type": "server_error"}},
        )
