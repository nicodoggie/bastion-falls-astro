import asyncio
import importlib.util
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from starlette.requests import Request

MODULE_PATH = Path(__file__).with_name("supervisor.py")
spec = importlib.util.spec_from_file_location("bastion_whisper_supervisor", MODULE_PATH)
assert spec and spec.loader
supervisor = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = supervisor
spec.loader.exec_module(supervisor)


class WorkerManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_acquire_keeps_lifecycle_lock_through_request_reservation(self):
        manager = supervisor.WorkerManager()

        async def start_locked():
            self.assertTrue(manager.lock.locked())
            manager.process = type("Process", (), {"returncode": None, "pid": 123})()

        with patch.object(manager, "_start_locked", side_effect=start_locked):
            await manager.acquire()

        self.assertEqual(manager.active_requests, 1)

    async def test_concurrent_acquire_starts_worker_once(self):
        manager = supervisor.WorkerManager()

        class Process:
            returncode = None
            pid = 123

        process = Process()
        response = type("Response", (), {"status_code": 200})()
        client = AsyncMock()
        client.get.return_value = response
        client_context = MagicMock()
        client_context.__aenter__.return_value = client
        client_context.__aexit__.return_value = None

        with (
            patch.object(
                supervisor.asyncio,
                "create_subprocess_exec",
                AsyncMock(return_value=process),
            ) as create_process,
            patch.object(supervisor.httpx, "AsyncClient", return_value=client_context),
        ):
            await asyncio.gather(manager.acquire(), manager.acquire())

        self.assertEqual(create_process.await_count, 1)
        self.assertEqual(manager.active_requests, 2)

    async def test_reaper_does_not_stop_active_worker(self):
        manager = supervisor.WorkerManager()
        manager.process = type("Process", (), {"returncode": None, "pid": 123})()
        manager.active_requests = 1
        manager.last_used = time.monotonic() - 999

        stop = AsyncMock()
        with (
            patch.object(supervisor, "IDLE_SECONDS", 0, create=True),
            patch.object(manager, "_stop_locked", stop),
        ):
            task = asyncio.create_task(manager.reap_loop())
            await asyncio.sleep(1.1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        stop.assert_not_awaited()


class RequestBodyTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_request_body_larger_than_supervisor_limit(self):
        chunks = [b"1234", b"5678", b"9"]

        async def receive():
            body = chunks.pop(0)
            return {
                "type": "http.request",
                "body": body,
                "more_body": bool(chunks),
            }

        request = Request({"type": "http", "method": "POST", "path": "/"}, receive)

        with patch.object(supervisor, "MAX_REQUEST_BYTES", 8):
            with self.assertRaises(supervisor.RequestTooLargeError):
                await supervisor.read_request_body(request)


if __name__ == "__main__":
    unittest.main()
