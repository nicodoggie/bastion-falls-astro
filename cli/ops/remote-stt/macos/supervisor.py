import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from contextlib import suppress
from pathlib import Path
from typing import Awaitable, TypeVar

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from job_store import JobRecord, JobStore

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
JOB_ROOT = Path(os.getenv("STT_JOB_ROOT", str(SERVICE_ROOT / "state" / "jobs")))
JOB_TTL_SECONDS = int(os.getenv("STT_JOB_TTL_SECONDS", str(7 * 24 * 60 * 60)))


class RequestTooLargeError(Exception):
    pass


class DownstreamDisconnectedError(Exception):
    pass


class DuplicateRequestError(Exception):
    pass


ResponseT = TypeVar("ResponseT")


async def await_worker_response(
    request: Request,
    response: Awaitable[ResponseT],
    *,
    poll_seconds: float = 0.25,
) -> ResponseT:
    task = asyncio.ensure_future(response)
    try:
        while not task.done():
            if await request.is_disconnected():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
                raise DownstreamDisconnectedError
            await asyncio.sleep(poll_seconds)
        return await task
    except BaseException:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        raise


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
        self.active_request_id: str | None = None
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

    async def acquire(self, request_id: str) -> None:
        async with self.lock:
            if self.active_request_id is not None:
                raise DuplicateRequestError
            await self._start_locked()
            if not self.running:
                raise RuntimeError("Whisper worker stopped before request dispatch")
            self.active_request_id = request_id
            self.active_requests = 1
            logger.info("Accepted transcription request %s", request_id)

    async def release(self) -> None:
        async with self.lock:
            if self.active_request_id is not None:
                logger.info("Released transcription request %s", self.active_request_id)
            self.active_request_id = None
            self.active_requests = 0
            self.last_used = time.monotonic()

    async def stop(self) -> None:
        async with self.lock:
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        process = self.process
        self.process = None
        if process is None or process.returncode is not None:
            return
        logger.info("Stopping Whisper worker (pid=%s)", process.pid)
        try:
            process.terminate()
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), timeout=20)
        except TimeoutError:
            logger.warning("Whisper worker did not stop gracefully; killing it")
            try:
                process.kill()
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


class JobRunner:
    def __init__(self, store: JobStore, worker_manager: WorkerManager) -> None:
        self.store = store
        self.worker_manager = worker_manager
        self.wake = asyncio.Event()
        self.run_task: asyncio.Task[None] | None = None
        self.cleanup_task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self.run_task = asyncio.create_task(self.run_loop())
        self.cleanup_task = asyncio.create_task(self.cleanup_loop())
        self.notify()

    def notify(self) -> None:
        self.wake.set()

    async def stop(self) -> None:
        tasks = [task for task in (self.run_task, self.cleanup_task) if task is not None]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        self.store.reconcile_interrupted()

    async def run_loop(self) -> None:
        while True:
            job = self.store.claim_next()
            if job is None:
                self.wake.clear()
                job = self.store.claim_next()
                if job is None:
                    await self.wake.wait()
                    continue
            await self._execute(job)

    async def _execute(self, job: JobRecord) -> None:
        acquired = False
        try:
            await self.worker_manager.acquire(job.id)
            acquired = True
            async with httpx.AsyncClient(timeout=None) as client:
                upstream = await client.post(
                    f"{WORKER_URL}/v1/audio/transcriptions",
                    content=self.store.read_payload(job.id),
                    headers={
                        "content-type": job.content_type,
                        "x-bastion-request-id": job.id,
                    },
                )
            self.store.succeed(
                job.id,
                result=upstream.content,
                status_code=upstream.status_code,
                media_type=upstream.headers.get("content-type"),
            )
            logger.info("Completed transcription job %s", job.id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Transcription job %s failed", job.id)
            with suppress(ValueError):
                self.store.fail(job.id, error_code="worker_failed")
        finally:
            if acquired:
                await self.worker_manager.release()

    async def cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(min(3600, max(60, JOB_TTL_SECONDS / 4)))
            removed = self.store.cleanup_expired(ttl_seconds=JOB_TTL_SECONDS)
            if removed:
                logger.info("Removed %s expired transcription jobs", removed)


manager = WorkerManager()
job_store: JobStore | None = None
job_runner: JobRunner | None = None
_start_time = time.time()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global job_runner, job_store
    job_store = JobStore(JOB_ROOT)
    reconciled = job_store.reconcile_interrupted()
    if reconciled:
        logger.warning("Requeued %s interrupted transcription jobs", reconciled)
    job_runner = JobRunner(job_store, manager)
    job_runner.start()
    manager.reaper_task = asyncio.create_task(manager.reap_loop())
    try:
        yield
    finally:
        if job_runner:
            await job_runner.stop()
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


def require_job_services() -> tuple[JobStore, JobRunner]:
    if job_store is None or job_runner is None:
        raise RuntimeError("Job service is not ready")
    return job_store, job_runner


def job_status_content(job: JobRecord) -> dict[str, object]:
    return {
        "id": job.id,
        "status": job.status,
        "attempts": job.attempts,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        **({"completedAt": job.completed_at} if job.completed_at is not None else {}),
        **({"errorCode": job.error_code} if job.error_code is not None else {}),
    }


@app.post("/v1/transcription-jobs")
async def submit_job(request: Request):
    try:
        store, runner = require_job_services()
        body = await read_request_body(request)
        job, created = store.submit(
            idempotency_key=request.headers.get("x-idempotency-key", ""),
            payload=body,
            content_type=request.headers.get("content-type", ""),
        )
        if created:
            runner.notify()
        return JSONResponse(
            status_code=202,
            content={**job_status_content(job), "created": created},
        )
    except RequestTooLargeError:
        return JSONResponse(
            status_code=413,
            content={"error": {"message": "Request body exceeds the 64 MiB limit", "type": "invalid_request_error"}},
        )
    except ValueError as error:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": str(error), "type": "invalid_request_error"}},
        )
    except RuntimeError:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Job service unavailable", "type": "server_error"}},
        )


@app.get("/v1/transcription-jobs/{job_id}")
async def get_job(job_id: str):
    try:
        store, _runner = require_job_services()
    except RuntimeError:
        return Response(status_code=503)
    job = store.get(job_id)
    if job is None:
        return Response(status_code=404)
    return JSONResponse(content=job_status_content(job))


@app.get("/v1/transcription-jobs/{job_id}/result")
async def get_job_result(job_id: str):
    try:
        store, _runner = require_job_services()
    except RuntimeError:
        return Response(status_code=503)
    job = store.get(job_id)
    if job is None:
        return Response(status_code=404)
    if job.status == "failed":
        return JSONResponse(
            status_code=422,
            content={"error": {"message": "Transcription job failed", "type": job.error_code or "server_error"}},
        )
    if job.status != "succeeded":
        return JSONResponse(
            status_code=409,
            content={"error": {"message": "Transcription job is not complete", "type": "conflict_error"}},
        )
    return Response(
        content=store.read_result(job.id),
        status_code=job.result_status_code or 200,
        media_type=job.result_media_type,
    )


@app.delete("/v1/transcription-jobs/{job_id}")
async def delete_job(job_id: str):
    try:
        store, _runner = require_job_services()
    except RuntimeError:
        return Response(status_code=503)
    outcome = store.delete(job_id)
    if outcome == "not_found":
        return Response(status_code=404)
    if outcome == "active":
        return JSONResponse(
            status_code=409,
            content={"error": {"message": "Active jobs cannot be deleted", "type": "conflict_error"}},
        )
    return Response(status_code=204)


@app.api_route(
    "/v1/audio/transcriptions",
    methods=["POST"],
)
async def transcribe(request: Request):
    try:
        body = await read_request_body(request)
        request_id = request.headers.get("x-bastion-request-id", "unidentified")
        await manager.acquire(request_id)
        try:
            headers = {
                key: value
                for key, value in request.headers.items()
                if key.lower() not in {"host", "content-length"}
            }
            async with httpx.AsyncClient(timeout=None) as client:
                upstream = await await_worker_response(
                    request,
                    client.post(
                        f"{WORKER_URL}/v1/audio/transcriptions",
                        content=body,
                        headers=headers,
                    ),
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
    except DownstreamDisconnectedError:
        logger.warning("Downstream disconnected; recycling Whisper worker")
        await manager.stop()
        return Response(status_code=499)
    except DuplicateRequestError:
        logger.warning(
            "Rejected concurrent transcription request %s while %s is active",
            request.headers.get("x-bastion-request-id", "unidentified"),
            manager.active_request_id,
        )
        return JSONResponse(
            status_code=409,
            content={"error": {"message": "Another transcription request is already active", "type": "conflict_error"}},
        )
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
