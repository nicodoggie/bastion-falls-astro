from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Awaitable, TypeVar

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from engines.base import EngineError, EngineResult, InferenceEngine
from engines.registry import EngineConfigurationError, create_engine
from job_store import JobRecord, JobStore
from service_config import ServiceConfigError, load_service_config

logger = logging.getLogger("bastion_whisper.supervisor")

SERVICE_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = SERVICE_ROOT / "config.yaml"
MAX_REQUEST_BYTES = 64 * 1024 * 1024
JOB_ROOT = Path(os.getenv("STT_JOB_ROOT", str(SERVICE_ROOT / "state" / "jobs")))
JOB_TTL_SECONDS = int(os.getenv("STT_JOB_TTL_SECONDS", str(7 * 24 * 60 * 60)))
API_KEY = os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY")


class RequestTooLargeError(Exception):
    pass


class DownstreamDisconnectedError(Exception):
    pass


ResponseT = TypeVar("ResponseT")


class AdmissionGate:
    """One process-wide admission gate shared by both request paths."""

    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._busy = False

    @property
    def busy(self) -> bool:
        return self._busy

    async def acquire_durable(self) -> None:
        async with self._condition:
            while self._busy:
                await self._condition.wait()
            self._busy = True

    def try_acquire_sync(self) -> bool:
        # This method never awaits, so the check-and-acquire is atomic on the
        # event loop.  Durable waiters use the same condition and re-check.
        if self._busy:
            return False
        self._busy = True
        return True

    async def release(self) -> None:
        async with self._condition:
            if not self._busy:
                return
            self._busy = False
            self._condition.notify_all()


async def _await_cleanup(awaitable: Awaitable[ResponseT]) -> ResponseT:
    """Settle one owned cleanup task despite repeated owner cancellation."""
    task = asyncio.ensure_future(awaitable)
    owner_cancelled = False
    while True:
        try:
            result = await asyncio.shield(task)
        except asyncio.CancelledError:
            if task.done():
                if owner_cancelled:
                    raise
                return task.result()
            owner_cancelled = True
            continue
        if owner_cancelled:
            raise asyncio.CancelledError
        return result


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
                    await _await_cleanup(task)
                raise DownstreamDisconnectedError
            await asyncio.sleep(poll_seconds)
        return await task
    except BaseException:
        if not task.done():
            task.cancel()
            await _await_cleanup(task)
        raise


async def read_request_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            raise RequestTooLargeError
        body.extend(chunk)
    return bytes(body)


class JobRunner:
    def __init__(self, store: JobStore, engine: InferenceEngine, gate: AdmissionGate | None = None) -> None:
        self.store = store
        self.engine = engine
        self.gate = gate or AdmissionGate()
        self.wake = asyncio.Event()
        self.run_task: asyncio.Task[None] | None = None
        self.cleanup_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        run_coro = self.run_loop()
        try:
            self.run_task = asyncio.create_task(run_coro)
        except BaseException:
            run_coro.close()
            raise
        cleanup_coro = self.cleanup_loop()
        try:
            self.cleanup_task = asyncio.create_task(cleanup_coro)
        except BaseException:
            cleanup_coro.close()
            self.run_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.run_task
            self.run_task = None
            try:
                self.store.reconcile_interrupted()
            except Exception:
                logger.warning("Runner startup reconciliation failed")
            raise
        self.notify()

    def notify(self) -> None:
        self.wake.set()

    async def stop(self) -> None:
        async def settle() -> None:
            tasks = [task for task in (self.run_task, self.cleanup_task) if task is not None]
            first_error: BaseException | None = None
            for task in tasks:
                task.cancel()
            for task in tasks:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception as error:
                    if first_error is None:
                        first_error = error
            try:
                self.store.reconcile_interrupted()
            except Exception as error:
                if first_error is None:
                    first_error = error
            if first_error is not None:
                raise first_error

        await _await_cleanup(settle())

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
        await self.gate.acquire_durable()
        try:
            result = await self.engine.transcribe(
                payload=self.store.read_payload(job.id),
                content_type=job.content_type,
                request_id=job.id,
            )
            self.store.succeed(
                job.id,
                result=result.content,
                status_code=result.status_code,
                media_type=result.media_type,
            )
        except asyncio.CancelledError:
            raise
        except EngineError as error:
            with suppress(ValueError):
                self.store.fail(job.id, error_code=error.code)
            logger.warning("Transcription job failed: code=%s", error.code)
        except Exception:
            with suppress(ValueError):
                self.store.fail(job.id, error_code="engine_inference_failed")
            logger.warning("Transcription job failed: code=engine_inference_failed")
        finally:
            await _await_cleanup(self.gate.release())

    async def cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(min(3600, max(60, JOB_TTL_SECONDS / 4)))
            removed = self.store.cleanup_expired(ttl_seconds=JOB_TTL_SECONDS)
            if removed:
                logger.info("Removed %s expired transcription jobs", removed)


# Composition globals intentionally remain inert at import time.
engine: InferenceEngine | None = None
job_store: JobStore | None = None
job_runner: JobRunner | None = None
adapter_reaper_task: asyncio.Task[None] | None = None
service_config = None
_admission_gate: AdmissionGate | None = None
_start_time = time.time()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global engine, job_store, job_runner, adapter_reaper_task, service_config, _admission_gate
    primary_error: BaseException | None = None
    cleanup_error: BaseException | None = None

    async def settle_shutdown() -> None:
        first_error: BaseException | None = None
        if job_runner is not None:
            try:
                await job_runner.stop()
            except BaseException as error:
                first_error = error
        if adapter_reaper_task is not None:
            adapter_reaper_task.cancel()
            try:
                await adapter_reaper_task
            except asyncio.CancelledError:
                pass
            except BaseException as error:
                if first_error is None:
                    first_error = error
        if engine is not None:
            try:
                await engine.stop()
            except BaseException as error:
                if first_error is None:
                    first_error = error
        if first_error is not None:
            raise first_error

    try:
        service_config = load_service_config(CONFIG_PATH)
        engine = create_engine(service_config.selected, SERVICE_ROOT)
        job_store = JobStore(JOB_ROOT)
        reconciled = job_store.reconcile_interrupted()
        if reconciled:
            logger.warning("Requeued %s interrupted transcription jobs", reconciled)
        _admission_gate = AdmissionGate()
        job_runner = JobRunner(job_store, engine, _admission_gate)
        await job_runner.start()
        reaper_coro = engine.reap_loop()
        try:
            adapter_reaper_task = asyncio.create_task(reaper_coro)
        except BaseException:
            reaper_coro.close()
            raise
        yield
    except BaseException as error:
        primary_error = error
    finally:
        try:
            await _await_cleanup(settle_shutdown())
        except BaseException as error:
            cleanup_error = error
        finally:
            engine = None
            job_runner = None
            job_store = None
            adapter_reaper_task = None
            service_config = None
            _admission_gate = None

    if primary_error is not None:
        raise primary_error
    if cleanup_error is not None:
        raise cleanup_error


app = FastAPI(title="Bastion Whisper On-Demand Supervisor", lifespan=lifespan)


@app.middleware("http")
async def authenticate(request: Request, call_next):
    if (
        API_KEY
        and request.url.path.startswith("/v1/")
        and request.headers.get("authorization", "") != f"Bearer {API_KEY}"
    ):
        return JSONResponse(
            status_code=401,
            content={
                "error": {
                    "message": "Invalid API key",
                    "type": "invalid_request_error",
                }
            },
        )
    return await call_next(request)


@app.get("/health")
async def health():
    selected = service_config.selected if service_config is not None else None
    return {
        "status": "ok",
        "profile": selected.name if selected else None,
        "engine": selected.engine if selected else None,
        "model": selected.model if selected else None,
        "model_loaded": bool(engine and engine.running),
        "engine_loaded": bool(engine and engine.running),
        "active_requests": engine.active_requests if engine else 0,
        "uptime_seconds": round(time.time() - _start_time, 1),
    }


@app.get("/v1/models")
async def list_models():
    selected = service_config.selected if service_config is not None else None
    return {
        "object": "list",
        "data": [
            {
                "id": "whisper-1",
                "object": "model",
                "created": int(_start_time),
                "owned_by": "local",
                "profile": selected.name if selected else None,
                "model": selected.model if selected else None,
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
        "statusUrl": f"/v1/transcription-jobs/{job.id}",
        "attempts": job.attempts,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        **({"completedAt": job.completed_at} if job.completed_at is not None else {}),
        **({"errorCode": job.error_code} if job.error_code is not None else {}),
        **(
            {"resultUrl": f"/v1/transcription-jobs/{job.id}/result"}
            if job.status == "succeeded"
            else {}
        ),
    }


@app.get("/v1/transcription-jobs/by-idempotency-key/{key}")
async def get_job_by_idempotency_key(key: str):
    if len(key) != 64 or any(character not in "0123456789abcdef" for character in key):
        return Response(status_code=400)
    try:
        store, _ = require_job_services()
    except RuntimeError:
        return Response(status_code=503)
    job = store.get_by_idempotency_key(key)
    if job is None:
        return Response(status_code=404)
    return JSONResponse(content=job_status_content(job))


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
        store, _ = require_job_services()
    except RuntimeError:
        return Response(status_code=503)
    job = store.get(job_id)
    if job is None:
        return Response(status_code=404)
    return JSONResponse(content=job_status_content(job))


@app.get("/v1/transcription-jobs/{job_id}/result")
async def get_job_result(job_id: str):
    try:
        store, _ = require_job_services()
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
    try:
        content = store.read_result(job.id)
    except (FileNotFoundError, OSError):
        logger.warning("Transcription result artifact unavailable")
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Transcription result unavailable", "type": "server_error"}},
        )
    return Response(content=content, status_code=job.result_status_code or 200, media_type=job.result_media_type)


@app.delete("/v1/transcription-jobs/{job_id}")
async def delete_job(job_id: str):
    try:
        store, _ = require_job_services()
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


@app.api_route("/v1/audio/transcriptions", methods=["POST"])
async def transcribe(request: Request):
    gate = _admission_gate
    current_engine = engine
    if current_engine is None or gate is None:
        return Response(status_code=503)
    if not gate.try_acquire_sync():
        return JSONResponse(
            status_code=409,
            content={
                "error": {
                    "message": "Another transcription request is already active",
                    "type": "conflict_error",
                }
            },
        )
    try:
        body = await read_request_body(request)
        request_id = request.headers.get("x-bastion-request-id", "unidentified")
        result = await await_worker_response(
            request,
            current_engine.transcribe(
                payload=body,
                content_type=request.headers.get("content-type", ""),
                request_id=request_id,
            ),
        )
        response_headers = (
            {"X-Worker-Process-Time-Ms": result.process_time_ms}
            if result.process_time_ms is not None
            else {}
        )
        return Response(
            content=result.content,
            status_code=result.status_code,
            headers=response_headers,
            media_type=result.media_type,
        )
    except DownstreamDisconnectedError:
        logger.warning("Downstream disconnected; recycling inference engine")
        await _await_cleanup(current_engine.stop())
        return Response(status_code=499)
    except EngineError as error:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "Inference engine unavailable",
                    "type": error.code,
                }
            },
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
        logger.warning("Inference request failed: code=engine_inference_failed")
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "Inference engine unavailable",
                    "type": "engine_inference_failed",
                }
            },
        )
    finally:
        await _await_cleanup(gate.release())
