import asyncio
import importlib.util
import json
import sys
import tempfile
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


class FakeEngine:
    name = "fake"
    model = "fake-model"

    def __init__(self, result=None):
        self.result = result or supervisor.EngineResult(b"result", 201, "audio/test", "12")
        self.calls = []
        self.running = False
        self.active_requests = 0
        self.idle_seconds = 300
        self.reap_loop = AsyncMock()
        self.stop = AsyncMock()

    async def transcribe(self, *, payload, content_type, request_id):
        self.calls.append(
            {
                "payload": payload,
                "content_type": content_type,
                "request_id": request_id,
            }
        )
        return self.result


class SupervisorCompositionTests(unittest.IsolatedAsyncioTestCase):
    def test_import_is_inert_and_has_no_legacy_worker_manager(self):
        self.assertIsNone(supervisor.engine)
        self.assertIsNone(supervisor.job_store)
        self.assertFalse(hasattr(supervisor, "WorkerManager"))

    async def test_lifespan_loads_fixed_config_constructs_one_engine_and_starts_three_tasks(self):
        config = MagicMock(selected=MagicMock(engine="fake", model="model", name="profile"))
        fake = FakeEngine()
        with (
            patch.object(supervisor, "load_service_config", return_value=config) as load,
            patch.object(supervisor, "create_engine", return_value=fake) as create,
            patch.object(supervisor, "JobStore") as store_type,
            patch.object(supervisor.asyncio, "create_task", wraps=asyncio.create_task) as task,
        ):
            store = store_type.return_value
            store.reconcile_interrupted.return_value = 0
            store.claim_next.return_value = None
            async with supervisor.lifespan(supervisor.app):
                load.assert_called_once_with(supervisor.CONFIG_PATH)
                create.assert_called_once_with(config.selected, supervisor.SERVICE_ROOT)
                self.assertIs(supervisor.engine, fake)
                self.assertEqual(task.call_count, 3)
        fake.stop.assert_awaited_once()

    async def test_lifespan_proves_runner_and_reaper_order(self):
        config = MagicMock(selected=MagicMock(engine="fake", model="secret-model", name="secret-profile"))
        order = []
        reaper_started = asyncio.Event()

        class RecordingRunner:
            def __init__(self, store, engine, gate):
                self.store = store
                self.run_task = asyncio.create_task(asyncio.sleep(3600))
                self.cleanup_task = asyncio.create_task(asyncio.sleep(3600))

            async def start(self):
                order.append("runner-start")

            async def stop(self):
                order.append("runner-stop")
                self.run_task.cancel()
                self.cleanup_task.cancel()
                await asyncio.gather(self.run_task, self.cleanup_task, return_exceptions=True)

        fake = FakeEngine()

        async def reaper():
            order.append("reaper-start")
            reaper_started.set()
            try:
                await asyncio.Future()
            finally:
                order.append("reaper-stop")

        fake.reap_loop = AsyncMock(side_effect=reaper)

        async def engine_stop():
            order.append("engine-stop")

        fake.stop = AsyncMock(side_effect=engine_stop)
        with (
            patch.object(supervisor, "load_service_config", return_value=config),
            patch.object(supervisor, "create_engine", return_value=fake),
            patch.object(supervisor, "JobStore"),
            patch.object(supervisor, "JobRunner", RecordingRunner),
        ):
            async with supervisor.lifespan(supervisor.app):
                await asyncio.wait_for(reaper_started.wait(), 1)
                self.assertEqual(order[:2], ["runner-start", "reaper-start"])

        self.assertEqual(order, ["runner-start", "reaper-start", "runner-stop", "reaper-stop", "engine-stop"])

    async def test_repeated_owner_cancellation_waits_for_shutdown_settlement(self):
        config = MagicMock(selected=MagicMock(engine="fake", model="model", name="profile"))
        fake = FakeEngine()
        stop_entered = asyncio.Event()
        release_stop = asyncio.Event()
        stop_finished = asyncio.Event()

        async def blocked_stop():
            stop_entered.set()
            await release_stop.wait()
            stop_finished.set()

        async def blocked_reaper():
            await asyncio.Future()

        fake.stop = AsyncMock(side_effect=blocked_stop)
        fake.reap_loop = AsyncMock(side_effect=blocked_reaper)

        with (
            patch.object(supervisor, "load_service_config", return_value=config),
            patch.object(supervisor, "create_engine", return_value=fake),
            patch.object(supervisor, "JobStore") as store_type,
        ):
            store = store_type.return_value
            store.claim_next.return_value = None
            store.reconcile_interrupted.return_value = 0
            cm = supervisor.lifespan(supervisor.app)
            await cm.__aenter__()
            runner = supervisor.job_runner
            reaper_task = supervisor.adapter_reaper_task
            owner = asyncio.create_task(cm.__aexit__(None, None, None))

            await asyncio.wait_for(stop_entered.wait(), 1)
            self.assertFalse(owner.done())
            self.assertIs(supervisor.engine, fake)
            self.assertIsNotNone(supervisor.job_runner)
            self.assertIsNotNone(supervisor.adapter_reaper_task)

            owner.cancel()
            await asyncio.wait_for(asyncio.sleep(0), 1)
            self.assertFalse(owner.done())
            self.assertFalse(stop_finished.is_set())
            self.assertIs(supervisor.engine, fake)

            owner.cancel()
            await asyncio.wait_for(asyncio.sleep(0), 1)
            self.assertFalse(owner.done())
            self.assertFalse(stop_finished.is_set())
            self.assertIsNotNone(supervisor._admission_gate)

            release_stop.set()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(owner, 1)

            self.assertTrue(stop_finished.is_set())
            fake.stop.assert_awaited_once()
            self.assertEqual(store.reconcile_interrupted.call_count, 2)
            self.assertTrue(runner.run_task.done())
            self.assertTrue(runner.cleanup_task.done())
            self.assertTrue(reaper_task.done())
            self.assertIsNone(supervisor.engine)
            self.assertIsNone(supervisor.job_store)
            self.assertIsNone(supervisor.job_runner)
            self.assertIsNone(supervisor.adapter_reaper_task)
            self.assertIsNone(supervisor.service_config)
            self.assertIsNone(supervisor._admission_gate)

    async def test_invalid_config_starts_no_tasks(self):
        with patch.object(supervisor, "load_service_config", side_effect=supervisor.ServiceConfigError("bad")), patch.object(supervisor.asyncio, "create_task") as create:
            with self.assertRaises(supervisor.ServiceConfigError):
                async with supervisor.lifespan(supervisor.app):
                    pass
            create.assert_not_called()

    async def test_invalid_engine_configuration_starts_no_tasks(self):
        config = MagicMock(selected=MagicMock())
        with (
            patch.object(supervisor, "load_service_config", return_value=config),
            patch.object(
                supervisor,
                "create_engine",
                side_effect=supervisor.EngineConfigurationError("unknown engine"),
            ),
            patch.object(supervisor.asyncio, "create_task") as create,
        ):
            with self.assertRaises(supervisor.EngineConfigurationError):
                async with supervisor.lifespan(supervisor.app):
                    pass
            create.assert_not_called()

    async def test_second_runner_task_failure_settles_first_task_and_engine(self):
        config = MagicMock(selected=MagicMock())
        fake = FakeEngine()
        calls = 0
        real_create_task = asyncio.create_task

        def fail_second(coro):
            nonlocal calls
            calls += 1
            if calls == 2:
                coro.close()
                raise RuntimeError("runner task creation failed")
            return real_create_task(coro)

        with (
            patch.object(supervisor, "load_service_config", return_value=config),
            patch.object(supervisor, "create_engine", return_value=fake),
            patch.object(supervisor, "JobStore") as store_type,
            patch.object(supervisor.asyncio, "create_task", side_effect=fail_second),
        ):
            store_type.return_value.claim_next.return_value = None
            with self.assertRaises(RuntimeError):
                async with supervisor.lifespan(supervisor.app):
                    pass
        fake.stop.assert_awaited_once()
        self.assertIsNone(supervisor.engine)
        self.assertIsNone(supervisor.job_runner)

    async def test_runner_task_creation_error_wins_over_reconciliation_error(self):
        startup_error = RuntimeError("exact runner startup sentinel")
        store = MagicMock()
        store.claim_next.return_value = None
        store.reconcile_interrupted.side_effect = RuntimeError(
            "cleanup must not replace runner startup"
        )
        runner = supervisor.JobRunner(store, FakeEngine())
        calls = 0
        real_create_task = asyncio.create_task

        def fail_second(coro):
            nonlocal calls
            calls += 1
            if calls == 2:
                coro.close()
                raise startup_error
            return real_create_task(coro)

        with (
            patch.object(supervisor.asyncio, "create_task", side_effect=fail_second),
            self.assertLogs(supervisor.logger, level="WARNING") as logs,
        ):
            with self.assertRaises(RuntimeError) as raised:
                await runner.start()

        self.assertIs(raised.exception, startup_error)
        self.assertIsNone(runner.run_task)
        store.reconcile_interrupted.assert_called_once_with()
        self.assertNotIn("cleanup must not replace", "\n".join(logs.output))

    async def test_reaper_task_failure_settles_runner_and_engine(self):
        config = MagicMock(selected=MagicMock())
        fake = FakeEngine()
        calls = 0
        real_create_task = asyncio.create_task

        def fail_reaper(coro):
            nonlocal calls
            calls += 1
            if calls == 3:
                coro.close()
                raise RuntimeError("reaper task creation failed")
            return real_create_task(coro)

        with (
            patch.object(supervisor, "load_service_config", return_value=config),
            patch.object(supervisor, "create_engine", return_value=fake),
            patch.object(supervisor, "JobStore") as store_type,
            patch.object(supervisor.asyncio, "create_task", side_effect=fail_reaper),
        ):
            store_type.return_value.claim_next.return_value = None
            with self.assertRaises(RuntimeError):
                async with supervisor.lifespan(supervisor.app):
                    pass
        fake.stop.assert_awaited_once()
        self.assertIsNone(supervisor.engine)
        self.assertIsNone(supervisor.adapter_reaper_task)

    async def test_reaper_startup_error_wins_over_cleanup_error(self):
        config = MagicMock(selected=MagicMock())
        fake = FakeEngine()
        startup_error = RuntimeError("exact startup sentinel")
        cleanup_error = RuntimeError("cleanup must not replace startup")
        calls = 0
        real_create_task = asyncio.create_task

        def fail_reaper(coro):
            nonlocal calls
            calls += 1
            if calls == 3:
                coro.close()
                raise startup_error
            return real_create_task(coro)

        fake.stop = AsyncMock(side_effect=cleanup_error)
        with (
            patch.object(supervisor, "load_service_config", return_value=config),
            patch.object(supervisor, "create_engine", return_value=fake),
            patch.object(supervisor, "JobStore") as store_type,
            patch.object(supervisor.asyncio, "create_task", side_effect=fail_reaper),
        ):
            store = store_type.return_value
            store.claim_next.return_value = None
            store.reconcile_interrupted.return_value = 0
            with self.assertRaises(RuntimeError) as raised:
                async with supervisor.lifespan(supervisor.app):
                    pass

        self.assertIs(raised.exception, startup_error)
        fake.stop.assert_awaited_once()
        self.assertEqual(store.reconcile_interrupted.call_count, 2)
        self.assertTrue(supervisor.job_runner is None)
        self.assertIsNone(supervisor.engine)
        self.assertIsNone(supervisor.job_store)
        self.assertIsNone(supervisor.adapter_reaper_task)
        self.assertIsNone(supervisor._admission_gate)

    async def test_job_runner_persists_exact_engine_result_and_keyword_call(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(idempotency_key="a" * 64, payload=b"payload", content_type="audio/test")
            claimed = store.claim_next()
            engine = FakeEngine(supervisor.EngineResult(b"bytes", 206, "audio/custom", "9"))
            await supervisor.JobRunner(store, engine)._execute(claimed)
            record = store.get(submitted.id)
            self.assertEqual(record.status, "succeeded")
            self.assertEqual(record.result_status_code, 206)
            self.assertEqual(record.result_media_type, "audio/custom")
            self.assertEqual(store.read_result(submitted.id), b"bytes")
            self.assertEqual(
                engine.calls,
                [{"payload": b"payload", "content_type": "audio/test", "request_id": submitted.id}],
            )

    async def test_engine_error_code_is_persisted_exactly(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(idempotency_key="b" * 64, payload=b"payload", content_type="audio/test")
            claimed = store.claim_next()
            engine = FakeEngine()
            engine.transcribe = AsyncMock(side_effect=supervisor.EngineError("engine_unavailable"))
            await supervisor.JobRunner(store, engine)._execute(claimed)
            self.assertEqual(store.get(submitted.id).error_code, "engine_unavailable")

    async def test_unexpected_engine_details_do_not_reach_record_or_warning(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(idempotency_key="c" * 64, payload=b"payload", content_type="audio/test")
            claimed = store.claim_next()
            engine = FakeEngine()
            engine.transcribe = AsyncMock(side_effect=RuntimeError("SECRET raw detail"))
            with self.assertLogs(supervisor.logger, level="WARNING") as logs:
                await supervisor.JobRunner(store, engine)._execute(claimed)
            record = store.get(submitted.id)
            self.assertEqual(record.error_code, "engine_inference_failed")
            self.assertNotIn("SECRET", repr(record))
            self.assertNotIn("SECRET", "\n".join(logs.output))

    async def test_runner_loop_shutdown_requeues_claimed_job_and_releases_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(
                idempotency_key="d" * 64,
                payload=b"payload",
                content_type="audio/test",
            )
            started = asyncio.Event()
            cancelled = asyncio.Event()
            release = asyncio.Event()

            class BlockingEngine(FakeEngine):
                async def transcribe(self, *, payload, content_type, request_id):
                    started.set()
                    try:
                        await asyncio.Future()
                    except asyncio.CancelledError:
                        cancelled.set()
                        await release.wait()
                        raise
                    return self.result

            gate = supervisor.AdmissionGate()
            runner = supervisor.JobRunner(store, BlockingEngine(), gate)
            await runner.start()
            await asyncio.wait_for(started.wait(), 1)
            self.assertEqual(store.get(submitted.id).status, "running")
            stopping = asyncio.create_task(runner.stop())
            await asyncio.wait_for(cancelled.wait(), 1)
            self.assertFalse(stopping.done())
            self.assertTrue(gate.busy)
            release.set()
            await asyncio.wait_for(stopping, 1)
            self.assertFalse(gate.busy)
            self.assertEqual(store.get(submitted.id).status, "queued")



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
            await supervisor.await_worker_response(request, worker_post(), poll_seconds=0)

        self.assertTrue(cancelled.is_set())

    async def test_repeated_owner_cancellation_waits_for_worker_cleanup(self):
        request = AsyncMock()
        request.is_disconnected.return_value = False
        worker_started = asyncio.Event()
        release_worker = asyncio.Event()
        worker_finished = asyncio.Event()
        cleanup_started = asyncio.Event()

        async def worker_post():
            worker_started.set()
            try:
                await asyncio.Future()
            finally:
                cleanup_started.set()
                await release_worker.wait()
                worker_finished.set()

        owner = asyncio.create_task(
            supervisor.await_worker_response(request, worker_post(), poll_seconds=0)
        )
        await asyncio.wait_for(worker_started.wait(), 1)
        owner.cancel()
        await asyncio.wait_for(cleanup_started.wait(), 1)
        owner.cancel()
        self.assertFalse(owner.done())
        self.assertFalse(worker_finished.is_set())
        release_worker.set()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(owner, 1)
        self.assertTrue(worker_finished.is_set())

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


class AdmissionGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_waiters_are_serialized_after_release(self):
        gate = supervisor.AdmissionGate()
        entered = []
        first = asyncio.create_task(gate.acquire_durable())
        await asyncio.sleep(0)
        second = asyncio.create_task(gate.acquire_durable())
        await asyncio.sleep(0)
        self.assertTrue(first.done())
        self.assertFalse(second.done())
        entered.append(1)
        await gate.release()
        await asyncio.wait_for(second, 1)
        entered.append(2)
        self.assertEqual(entered, [1, 2])
        await gate.release()

    async def test_held_gate_rejects_sync_request_without_engine_call(self):
        gate = supervisor.AdmissionGate()
        self.assertTrue(gate.try_acquire_sync())
        engine = FakeEngine()
        request = MagicMock(headers={"content-type": "audio/test"})
        with patch.object(supervisor, "engine", engine), patch.object(supervisor, "_admission_gate", gate):
            response = await supervisor.transcribe(request)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(engine.calls, [])
        await gate.release()

    async def test_cancellation_releases_sync_admission(self):
        gate = supervisor.AdmissionGate()
        engine = FakeEngine()
        request = MagicMock(headers={"content-type": "audio/test"})
        stop_started = asyncio.Event()
        release_stop = asyncio.Event()

        async def cancelled(_request, response):
            response.close()
            raise supervisor.DownstreamDisconnectedError

        async def blocked_stop():
            stop_started.set()
            await release_stop.wait()

        engine.stop = AsyncMock(side_effect=blocked_stop)
        with (
            patch.object(supervisor, "engine", engine),
            patch.object(supervisor, "_admission_gate", gate),
            patch.object(supervisor, "read_request_body", AsyncMock(return_value=b"x")),
            patch.object(supervisor, "await_worker_response", side_effect=cancelled),
        ):
            owner = asyncio.create_task(supervisor.transcribe(request))
            await asyncio.wait_for(stop_started.wait(), 1)
            owner.cancel()
            owner.cancel()
            self.assertFalse(owner.done())
            self.assertTrue(gate.busy)
            release_stop.set()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(owner, 1)
        self.assertFalse(gate.busy)
        engine.stop.assert_awaited_once()

    async def test_missing_gate_returns_503_without_reading_body(self):
        body = AsyncMock()
        with (
            patch.object(supervisor, "engine", FakeEngine()),
            patch.object(supervisor, "_admission_gate", None),
            patch.object(supervisor, "read_request_body", body),
        ):
            response = await supervisor.transcribe(MagicMock(headers={}))
        self.assertEqual(response.status_code, 503)
        body.assert_not_awaited()

    async def test_busy_gate_returns_409_without_reading_body(self):
        gate = supervisor.AdmissionGate()
        self.assertTrue(gate.try_acquire_sync())
        body = AsyncMock()
        try:
            with (
                patch.object(supervisor, "engine", FakeEngine()),
                patch.object(supervisor, "_admission_gate", gate),
                patch.object(supervisor, "read_request_body", body),
            ):
                response = await supervisor.transcribe(MagicMock(headers={}))
            self.assertEqual(response.status_code, 409)
            body.assert_not_awaited()
        finally:
            await gate.release()

    async def test_oversized_body_releases_gate_and_allows_next_request(self):
        gate = supervisor.AdmissionGate()
        engine = FakeEngine()
        body = AsyncMock(side_effect=[supervisor.RequestTooLargeError, b"input"])

        async def return_response(_request, response):
            return await response

        with (
            patch.object(supervisor, "engine", engine),
            patch.object(supervisor, "_admission_gate", gate),
            patch.object(supervisor, "read_request_body", body),
            patch.object(supervisor, "await_worker_response", side_effect=return_response),
        ):
            oversized = await supervisor.transcribe(MagicMock(headers={"content-type": "audio/test"}))
            self.assertEqual(oversized.status_code, 413)
            self.assertFalse(gate.busy)
            succeeding = await supervisor.transcribe(MagicMock(headers={"content-type": "audio/test"}))

        self.assertEqual(succeeding.status_code, 201)
        self.assertFalse(gate.busy)

    async def test_unexpected_http_engine_error_is_sanitized_and_releases_gate(self):
        gate = supervisor.AdmissionGate()
        engine = FakeEngine()
        secret = "SECRET /path"
        engine.transcribe = AsyncMock(
            side_effect=[RuntimeError(secret), supervisor.EngineResult(b"ok", 200, "audio/test")]
        )

        async def invoke(_request, response):
            return await response

        with (
            patch.object(supervisor, "engine", engine),
            patch.object(supervisor, "_admission_gate", gate),
            patch.object(supervisor, "read_request_body", AsyncMock(return_value=b"input")),
            patch.object(supervisor, "await_worker_response", side_effect=invoke),
            self.assertLogs(supervisor.logger, level="WARNING") as logs,
        ):
            failed = await supervisor.transcribe(MagicMock(headers={"content-type": "audio/test"}))
            self.assertEqual(failed.status_code, 503)
            self.assertFalse(gate.busy)
            succeeded = await supervisor.transcribe(MagicMock(headers={"content-type": "audio/test"}))

        self.assertEqual(succeeded.status_code, 200)
        self.assertFalse(gate.busy)
        self.assertNotIn(secret, failed.body.decode())
        self.assertNotIn(secret, "\n".join(logs.output))

    async def test_route_is_unavailable_without_composed_gate(self):
        with patch.object(supervisor, "engine", FakeEngine()), patch.object(supervisor, "_admission_gate", None):
            response = await supervisor.transcribe(MagicMock(headers={}))
        self.assertEqual(response.status_code, 503)


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


class SupervisorCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_endpoint_preserves_result_bytes_status_media_and_header(self):
        engine = FakeEngine(supervisor.EngineResult(b"exact", 202, "audio/wav", "17"))
        request = MagicMock()
        request.headers = {"content-type": "audio/test", "x-bastion-request-id": "req"}
        async def return_response(_request, response):
            return await response

        with patch.object(supervisor, "engine", engine), patch.object(supervisor, "_admission_gate", supervisor.AdmissionGate()), patch.object(supervisor, "read_request_body", AsyncMock(return_value=b"input")), patch.object(supervisor, "await_worker_response", side_effect=return_response):
            response = await supervisor.transcribe(request)
        self.assertEqual(response.body, b"exact")
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.media_type, "audio/wav")
        self.assertEqual(response.headers["x-worker-process-time-ms"], "17")
        self.assertEqual(engine.calls, [{"payload": b"input", "content_type": "audio/test", "request_id": "req"}])

    async def test_disconnect_stops_adapter_and_returns_499(self):
        engine = FakeEngine()

        async def disconnect(_request, response):
            response.close()
            raise supervisor.DownstreamDisconnectedError

        with patch.object(supervisor, "engine", engine), patch.object(supervisor, "_admission_gate", supervisor.AdmissionGate()), patch.object(supervisor, "read_request_body", AsyncMock(return_value=b"input")), patch.object(supervisor, "await_worker_response", side_effect=disconnect):
            response = await supervisor.transcribe(MagicMock(headers={"content-type": "audio/test"}))
        self.assertEqual(response.status_code, 499)
        engine.stop.assert_awaited_once()

    def test_route_checks_are_keyed_by_method_and_path(self):
        routes = {(method, route.path) for route in supervisor.app.routes for method in (route.methods or set())}
        self.assertIn(("GET", "/v1/transcription-jobs/{job_id}"), routes)
        self.assertIn(("DELETE", "/v1/transcription-jobs/{job_id}"), routes)
        self.assertIn(("POST", "/v1/audio/transcriptions"), routes)

    async def test_status_and_result_keep_durable_http_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(idempotency_key="d" * 64, payload=b"x", content_type="audio/test")
            with patch.object(supervisor, "job_store", store), patch.object(supervisor, "job_runner", MagicMock()):
                queued = json.loads((await supervisor.get_job(submitted.id)).body)
                self.assertNotIn("resultUrl", queued)
                claimed = store.claim_next()
                store.succeed(claimed.id, result=b"r", status_code=203, media_type="audio/r")
                result = await supervisor.get_job_result(submitted.id)
            self.assertEqual(result.body, b"r")
            self.assertEqual(result.status_code, 203)
            self.assertEqual(result.media_type, "audio/r")

    async def test_missing_result_artifact_is_fixed_503_without_path(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(idempotency_key="f" * 64, payload=b"x", content_type="audio/test")
            claimed = store.claim_next()
            store.succeed(claimed.id, result=b"r", status_code=200, media_type="audio/r")
            result_path = store.results / f"{submitted.id}.result"
            result_path.unlink()
            with patch.object(supervisor, "job_store", store), patch.object(supervisor, "job_runner", MagicMock()):
                with self.assertLogs(supervisor.logger, level="WARNING") as logs:
                    response = await supervisor.get_job_result(submitted.id)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(json.loads(response.body), {"error": {"message": "Transcription result unavailable", "type": "server_error"}})
            self.assertNotIn(str(result_path), "\n".join(logs.output))

    async def test_cold_health_does_not_expose_selected_config_details(self):
        selected = MagicMock()
        selected.name = "primary"
        selected.engine = "mlx-whisper"
        selected.model = "org/model"
        selected.config = {"binary_path": "/SECRET/provider/path"}
        config = MagicMock(selected=selected)
        with patch.object(supervisor, "service_config", config), patch.object(supervisor, "engine", None):
            health = await supervisor.health()
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["profile"], "primary")
        self.assertEqual(health["engine"], "mlx-whisper")
        self.assertEqual(health["model"], "org/model")
        self.assertNotIn("SECRET", repr(health))
        self.assertFalse(health["engine_loaded"])
        self.assertFalse(health["model_loaded"])
        self.assertEqual(health["active_requests"], 0)
    async def test_models_listing_does_not_expose_selected_config_details(self):
        selected = MagicMock()
        selected.name = "primary"
        selected.engine = "mlx-whisper"
        selected.model = "org/model"
        selected.config = {"model_path": "/SECRET/provider/path"}
        with patch.object(supervisor, "service_config", MagicMock(selected=selected)):
            payload = await supervisor.list_models()
        self.assertNotIn("SECRET", repr(payload))
        self.assertEqual(payload["data"][0]["profile"], "primary")
        self.assertEqual(payload["data"][0]["model"], "org/model")

    async def test_idempotency_lookup_does_not_read_a_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            store = supervisor.JobStore(Path(directory) / "jobs")
            submitted, _ = store.submit(
                idempotency_key="e" * 64,
                payload=b"payload",
                content_type="audio/test",
            )
            with (
                patch.object(supervisor, "job_store", store),
                patch.object(supervisor, "job_runner", MagicMock()),
            ):
                response = await supervisor.get_job_by_idempotency_key("e" * 64)
                missing = await supervisor.get_job_by_idempotency_key("f" * 64)

            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.body)["id"], submitted.id)
            self.assertEqual(missing.status_code, 404)

    async def test_repeated_submission_returns_same_job_and_notifies_once(self):
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
                            (b"content-type", b"audio/test"),
                        ],
                    },
                    receive,
                )
                with (
                    patch.object(supervisor, "job_store", store),
                    patch.object(supervisor, "job_runner", runner),
                ):
                    return await supervisor.submit_job(request)

            first = await submit("a" * 64, b"first")
            second = await submit("a" * 64, b"retry")
            first_body = json.loads(first.body)
            second_body = json.loads(second.body)

            self.assertEqual(first.status_code, 202)
            self.assertEqual(second.status_code, 202)
            self.assertEqual(first_body["id"], second_body["id"])
            self.assertTrue(first_body["created"])
            self.assertFalse(second_body["created"])
            runner.notify.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
