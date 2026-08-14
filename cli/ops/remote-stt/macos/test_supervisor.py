import asyncio
import importlib.util
import json
import sys
import tempfile
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
            await manager.acquire("first")

        self.assertEqual(manager.active_requests, 1)

    async def test_concurrent_acquire_starts_worker_once_and_rejects_duplicate_work(self):
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
            results = await asyncio.gather(
                manager.acquire("first"),
                manager.acquire("second"),
                return_exceptions=True,
            )

        self.assertEqual(create_process.await_count, 1)
        self.assertIsNone(results[0])
        self.assertIsInstance(results[1], supervisor.DuplicateRequestError)
        self.assertEqual(manager.active_requests, 1)
        self.assertEqual(manager.active_request_id, "first")

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

    async def test_worker_uses_parent_job_lifecycle_instead_of_a_new_session(self):
        manager = supervisor.WorkerManager()

        class Process:
            returncode = None
            pid = 123

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
                AsyncMock(return_value=Process()),
            ) as create_process,
            patch.object(supervisor.httpx, "AsyncClient", return_value=client_context),
        ):
            await manager.start()

        self.assertNotIn("start_new_session", create_process.await_args.kwargs)

    async def test_rejects_a_second_inflight_request_without_starting_worker_work(self):
        manager = supervisor.WorkerManager()
        manager.active_request_id = "remote-test:left:35:1"
        manager.active_requests = 1

        with self.assertRaises(supervisor.DuplicateRequestError):
            await manager.acquire("remote-test:left:35:2")

        self.assertEqual(manager.active_request_id, "remote-test:left:35:1")
        self.assertEqual(manager.active_requests, 1)


class ForwardingTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancels_worker_post_when_downstream_disconnects(self):
        request = AsyncMock()
        request.is_disconnected.side_effect = [False, True]
        cancelled = asyncio.Event()

        async def worker_post():
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        with self.assertRaises(supervisor.DownstreamDisconnectedError):
            await supervisor.await_worker_response(
                request,
                worker_post(),
                poll_seconds=0,
            )

        self.assertTrue(cancelled.is_set())

    async def test_returns_worker_response_while_downstream_remains_connected(self):
        request = AsyncMock()
        request.is_disconnected.return_value = False
        response = object()

        self.assertIs(
            await supervisor.await_worker_response(
                request,
                asyncio.sleep(0, result=response),
                poll_seconds=0,
            ),
            response,
        )


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


class DurableJobRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_executes_a_claimed_job_and_persists_the_worker_result(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(
                idempotency_key="a" * 64,
                payload=b"multipart request",
                content_type="multipart/form-data; boundary=test",
            )
            claimed = store.claim_next()
            manager = AsyncMock()
            response = type(
                "Response",
                (),
                {
                    "content": b'{"segments":[]}',
                    "status_code": 200,
                    "headers": {"content-type": "application/json"},
                },
            )()
            client = AsyncMock()
            client.post.return_value = response
            client_context = MagicMock()
            client_context.__aenter__.return_value = client
            client_context.__aexit__.return_value = None

            with patch.object(supervisor.httpx, "AsyncClient", return_value=client_context):
                await supervisor.JobRunner(store, manager)._execute(claimed)

            record = store.get(submitted.id)
            self.assertEqual(record.status, "succeeded")
            self.assertEqual(store.read_result(submitted.id), b'{"segments":[]}')
            manager.acquire.assert_awaited_once_with(submitted.id)
            manager.release.assert_awaited_once()


class DurableJobApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolves_an_existing_job_by_idempotency_key_without_a_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(
                idempotency_key="c" * 64,
                payload=b"multipart request",
                content_type="multipart/form-data; boundary=test",
            )
            with (
                patch.object(supervisor, "job_store", store),
                patch.object(supervisor, "job_runner", MagicMock()),
            ):
                response = await supervisor.get_job_by_idempotency_key("c" * 64)
                missing = await supervisor.get_job_by_idempotency_key("d" * 64)

            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.body)["id"], submitted.id)
            self.assertEqual(missing.status_code, 404)

    async def test_status_advertises_result_resource_only_after_success(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(
                idempotency_key="a" * 64,
                payload=b"multipart request",
                content_type="multipart/form-data; boundary=test",
            )
            with (
                patch.object(supervisor, "job_store", store),
                patch.object(supervisor, "job_runner", MagicMock()),
            ):
                queued = json.loads((await supervisor.get_job(submitted.id)).body)
                self.assertEqual(
                    queued["statusUrl"],
                    f"/v1/transcription-jobs/{submitted.id}",
                )
                self.assertNotIn("resultUrl", queued)

                claimed = store.claim_next()
                store.succeed(
                    claimed.id,
                    result=b'{"segments":[]}',
                    status_code=200,
                    media_type="application/json",
                )
                succeeded = json.loads((await supervisor.get_job(submitted.id)).body)

            self.assertEqual(
                succeeded["resultUrl"],
                f"/v1/transcription-jobs/{submitted.id}/result",
            )

    async def test_repeated_submission_returns_the_existing_job_and_notifies_runner_once(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            runner = MagicMock()

            async def submit(key: str, body: bytes):
                sent = False

                async def receive():
                    nonlocal sent
                    if sent:
                        return {"type": "http.disconnect"}
                    sent = True
                    return {"type": "http.request", "body": body, "more_body": False}

                request = Request(
                    {
                        "type": "http",
                        "method": "POST",
                        "path": "/v1/transcription-jobs",
                        "headers": [
                            (b"x-idempotency-key", key.encode()),
                            (b"content-type", b"multipart/form-data; boundary=test"),
                        ],
                    },
                    receive,
                )
                with (
                    patch.object(supervisor, "job_store", store),
                    patch.object(supervisor, "job_runner", runner),
                ):
                    return await supervisor.submit_job(request)

            first = await submit("b" * 64, b"first payload")
            second = await submit("b" * 64, b"retry payload")
            first_body = json.loads(first.body)
            second_body = json.loads(second.body)

            self.assertEqual(first.status_code, 202)
            self.assertEqual(second.status_code, 202)
            self.assertEqual(second_body["id"], first_body["id"])
            self.assertTrue(first_body["created"])
            self.assertFalse(second_body["created"])
            runner.notify.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
