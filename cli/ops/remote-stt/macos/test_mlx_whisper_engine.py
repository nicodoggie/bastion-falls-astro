import asyncio
import importlib
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from engines.base import EngineError, EngineResult
from engines.registry import EngineConfigurationError
from engines.mlx_whisper import MlxWhisperEngine, create_engine


class Process:
    def __init__(self, returncode=None):
        self.returncode = returncode
        self.pid = 123
        self.terminate = MagicMock()
        self.kill = MagicMock()
        self.wait = AsyncMock()


class MlxWhisperEngineTests(unittest.IsolatedAsyncioTestCase):
    def profile(self, config=None, model="org/model"):
        return SimpleNamespace(model=model, config={} if config is None else config)

    def ready_client(self):
        response = SimpleNamespace(status_code=200)
        client = AsyncMock()
        client.get.return_value = response
        context = MagicMock()
        context.__aenter__.return_value = client
        context.__aexit__.return_value = None
        return context, client

    def test_factory_is_cold_and_exposes_model_metadata(self):
        with patch("engines.mlx_whisper.asyncio.create_subprocess_exec", AsyncMock()) as spawn, patch("engines.mlx_whisper.httpx.AsyncClient") as client:
            engine = create_engine(self.profile(), Path("/service"))
        self.assertEqual(engine.name, "mlx-whisper")
        self.assertEqual(engine.model, "org/model")
        self.assertFalse(engine.running)
        self.assertEqual(engine.active_requests, 0)
        spawn.assert_not_awaited()
        client.assert_not_called()

    def test_config_is_strict_and_defaults(self):
        engine = create_engine(self.profile(), Path("/service"))
        self.assertEqual(engine.worker_port, 8001)
        self.assertEqual(engine.idle_seconds, 300)
        self.assertEqual(engine.start_timeout_seconds, 90)
        for config in ({"unknown": 1}, {"worker_port": True}, {"idle_seconds": float("nan")}, {"start_timeout_seconds": 0}, {"worker_port": 65536}):
            with self.subTest(config=config), self.assertRaises(EngineConfigurationError):
                create_engine(self.profile(config), Path("/service"))

    async def test_start_command_environment_cwd_and_no_new_session(self):
        engine = create_engine(self.profile({"worker_port": 8123}), Path("/service"))
        process = Process()
        context, client = self.ready_client()
        with patch("engines.mlx_whisper.asyncio.create_subprocess_exec", AsyncMock(return_value=process)) as spawn, patch("engines.mlx_whisper.httpx.AsyncClient", return_value=context), patch("engines.mlx_whisper.asyncio.sleep", AsyncMock()):
            await engine.start()
        self.assertEqual(spawn.await_args.args, ("/service/venv/bin/python", "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8123", "--workers", "1"))
        kwargs = spawn.await_args.kwargs
        self.assertEqual(kwargs["cwd"], "/service/app")
        self.assertEqual(kwargs["env"]["HOST"], "127.0.0.1")
        self.assertEqual(kwargs["env"]["PORT"], "8123")
        self.assertEqual(kwargs["env"]["STT_MODEL"], "org/model")
        self.assertNotIn("start_new_session", kwargs)
        client.get.assert_awaited_once_with("http://127.0.0.1:8123/health")

    async def test_start_failure_is_fixed_detached_error_and_cleans_process(self):
        engine = create_engine(self.profile(), Path("/service"))
        process = Process(returncode=1)
        context, _ = self.ready_client()
        with patch("engines.mlx_whisper.asyncio.create_subprocess_exec", AsyncMock(return_value=process)), patch("engines.mlx_whisper.httpx.AsyncClient", return_value=context):
            with self.assertRaises(EngineError) as raised:
                await engine.start()
        self.assertEqual(raised.exception.code, "engine_start_failed")
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)
        self.assertFalse(engine.running)

    async def test_transcribe_posts_exact_payload_and_returns_exact_result(self):
        engine = create_engine(self.profile(), Path("/service"))
        process = Process()
        ready_context, _ = self.ready_client()
        response = SimpleNamespace(content=b"result", status_code=201, headers={"content-type": "audio/wav", "x-process-time-ms": "17"})
        post_context = MagicMock()
        post_context.__aenter__.return_value = post_context
        post_context.__aexit__.return_value = None
        post_context.post = AsyncMock(return_value=response)
        with patch("engines.mlx_whisper.asyncio.create_subprocess_exec", AsyncMock(return_value=process)), patch("engines.mlx_whisper.httpx.AsyncClient", side_effect=[ready_context, post_context]), patch("engines.mlx_whisper.asyncio.sleep", AsyncMock()):
            result = await engine.transcribe(payload=b"multipart", content_type="multipart/form-data; boundary=x", request_id="safe-id")
        self.assertEqual(result, EngineResult(b"result", 201, "audio/wav", "17"))
        post_context.post.assert_awaited_once_with("http://127.0.0.1:8001/v1/audio/transcriptions", content=b"multipart", headers={"content-type": "multipart/form-data; boundary=x", "x-bastion-request-id": "safe-id"})

    async def test_duplicate_is_bounded_and_release_happens_on_transport_failure(self):
        engine = create_engine(self.profile(), Path("/service"))
        process = Process()
        ready_context, _ = self.ready_client()
        post_context = MagicMock()
        post_context.__aenter__.return_value = post_context
        post_context.__aexit__.return_value = None
        post_context.post = AsyncMock(side_effect=RuntimeError("secret"))
        with patch("engines.mlx_whisper.asyncio.create_subprocess_exec", AsyncMock(return_value=process)), patch("engines.mlx_whisper.httpx.AsyncClient", side_effect=[ready_context, post_context]), patch("engines.mlx_whisper.asyncio.sleep", AsyncMock()):
            task = asyncio.create_task(engine.transcribe(payload=b"x", content_type="x", request_id="one"))
            await asyncio.sleep(0)
            with self.assertRaises(EngineError) as duplicate:
                await engine.transcribe(payload=b"y", content_type="y", request_id="two")
            with self.assertRaises(EngineError) as failure:
                await task
        self.assertEqual(duplicate.exception.code, "engine_inference_failed")
        self.assertEqual(failure.exception.code, "engine_inference_failed")
        self.assertIsNone(failure.exception.__cause__)
        self.assertIsNone(failure.exception.__context__)
        self.assertNotIn("secret", repr(failure.exception))
        self.assertEqual(engine.active_requests, 0)

    async def test_concurrent_transcription_starts_once_and_rejects_duplicate_work(self):
        engine = create_engine(self.profile(), Path("/service"))
        process = Process()
        ready_context, _ = self.ready_client()
        entered = asyncio.Event()
        finish = asyncio.Event()
        response = SimpleNamespace(content=b"result", status_code=200, headers={})

        async def blocked_post(*args, **kwargs):
            entered.set()
            await finish.wait()
            return response

        post_context = MagicMock()
        post_context.__aenter__.return_value = post_context
        post_context.__aexit__.return_value = None
        post_context.post = AsyncMock(side_effect=blocked_post)
        with patch(
            "engines.mlx_whisper.asyncio.create_subprocess_exec",
            AsyncMock(return_value=process),
        ) as spawn, patch(
            "engines.mlx_whisper.httpx.AsyncClient",
            side_effect=[ready_context, post_context],
        ):
            first = asyncio.create_task(
                engine.transcribe(payload=b"x", content_type="x", request_id="one")
            )
            await entered.wait()
            with self.assertRaises(EngineError) as duplicate:
                await engine.transcribe(payload=b"y", content_type="y", request_id="two")
            self.assertEqual(duplicate.exception.code, "engine_inference_failed")
            self.assertEqual(engine.active_requests, 1)
            self.assertEqual(spawn.await_count, 1)
            self.assertEqual(post_context.post.await_count, 1)
            finish.set()
            self.assertEqual(await first, EngineResult(b"result", 200, None))
        self.assertEqual(engine.active_requests, 0)

    async def test_cancellation_releases_reservation(self):
        engine = create_engine(self.profile(), Path("/service"))
        process = Process()
        ready_context, _ = self.ready_client()
        post_context = MagicMock()
        post_context.__aenter__.return_value = post_context
        post_context.__aexit__.return_value = None
        post_context.post = AsyncMock(side_effect=asyncio.CancelledError)
        with patch("engines.mlx_whisper.asyncio.create_subprocess_exec", AsyncMock(return_value=process)), patch("engines.mlx_whisper.httpx.AsyncClient", side_effect=[ready_context, post_context]), patch("engines.mlx_whisper.asyncio.sleep", AsyncMock()):
            with self.assertRaises(asyncio.CancelledError):
                await engine.transcribe(payload=b"x", content_type="x", request_id="one")
        self.assertEqual(engine.active_requests, 0)

    async def test_repeated_cancellation_waits_for_release_cleanup(self):
        engine = create_engine(self.profile(), Path("/service"))
        engine.active_request_id = "one"
        release_entered = asyncio.Event()
        release_gate = asyncio.Event()
        release_calls = 0

        async def blocked_release():
            nonlocal release_calls
            release_calls += 1
            release_entered.set()
            await release_gate.wait()
            engine.active_request_id = None

        async def acquire(request_id):
            engine.active_request_id = request_id

        engine._acquire = acquire
        engine._release = blocked_release
        post_context = MagicMock()
        post_context.__aenter__.return_value = post_context
        post_context.__aexit__.return_value = None
        post_context.post = AsyncMock(side_effect=RuntimeError("transport"))
        with patch("engines.mlx_whisper.httpx.AsyncClient", return_value=post_context):
            owner = asyncio.create_task(
                engine.transcribe(payload=b"x", content_type="x", request_id="one")
            )
            await release_entered.wait()
        owner.cancel()
        await asyncio.sleep(0)
        owner.cancel()
        await asyncio.sleep(0)
        self.assertFalse(owner.done())
        self.assertEqual(engine.active_requests, 1)
        release_gate.set()
        with self.assertRaises(asyncio.CancelledError):
            await owner
        self.assertEqual(release_calls, 1)
        self.assertEqual(engine.active_requests, 0)

    async def test_repeated_cancellation_waits_for_direct_child_reap(self):
        engine = create_engine(self.profile(), Path("/service"))
        process = Process()
        wait_entered = asyncio.Event()
        wait_gate = asyncio.Event()

        async def blocked_wait():
            wait_entered.set()
            await wait_gate.wait()
            process.returncode = 0

        process.wait.side_effect = blocked_wait
        engine.process = process
        stop = asyncio.create_task(engine.stop())
        await wait_entered.wait()
        stop.cancel()
        await asyncio.sleep(0)
        stop.cancel()
        await asyncio.sleep(0)
        self.assertFalse(stop.done())
        self.assertIs(engine.process, process)
        with patch("engines.mlx_whisper.asyncio.create_subprocess_exec", AsyncMock()) as spawn:
            duplicate = asyncio.create_task(engine.start())
            await asyncio.sleep(0)
            self.assertFalse(duplicate.done())
            spawn.assert_not_awaited()
            duplicate.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await duplicate
        wait_gate.set()
        with self.assertRaises(asyncio.CancelledError):
            await stop
        self.assertIsNone(engine.process)

    async def test_control_flow_exceptions_propagate_and_release_reservation(self):
        engine = create_engine(self.profile(), Path("/service"))
        process = Process()
        ready_context, _ = self.ready_client()
        post_context = MagicMock()
        post_context.__aenter__.return_value = post_context
        post_context.__aexit__.return_value = None
        post_context.post = AsyncMock(side_effect=SystemExit("stop"))
        with patch(
            "engines.mlx_whisper.asyncio.create_subprocess_exec",
            AsyncMock(return_value=process),
        ), patch(
            "engines.mlx_whisper.httpx.AsyncClient",
            side_effect=[ready_context, post_context],
        ), patch("engines.mlx_whisper.asyncio.sleep", AsyncMock()):
            with self.assertRaises(SystemExit):
                await engine.transcribe(payload=b"x", content_type="x", request_id="one")
        self.assertEqual(engine.active_requests, 0)

    async def test_control_flow_exception_during_startup_is_not_sanitized(self):
        engine = create_engine(self.profile(), Path("/service"))
        with patch(
            "engines.mlx_whisper.asyncio.create_subprocess_exec",
            AsyncMock(side_effect=KeyboardInterrupt),
        ):
            with self.assertRaises(KeyboardInterrupt):
                await engine.start()

    async def test_stop_uses_term_then_kill_after_timeout_and_reaper_ignores_active(self):
        engine = create_engine(self.profile({"idle_seconds": 1}), Path("/service"))
        process = Process()
        process.wait.return_value = None
        engine.process = process
        engine.active_request_id = "active"
        engine.last_used = time.monotonic() - 100
        stop = AsyncMock()
        with patch.object(engine, "_stop_locked", stop), patch("engines.mlx_whisper.asyncio.sleep", AsyncMock(side_effect=asyncio.CancelledError)):
            with self.assertRaises(asyncio.CancelledError):
                await engine.reap_loop()
        stop.assert_not_awaited()
        async def timeout_wait(awaitable, *, timeout):
            awaitable.close()
            raise asyncio.TimeoutError

        with patch("engines.mlx_whisper.asyncio.wait_for", side_effect=timeout_wait):
            await engine.stop()
        process.terminate.assert_called_once_with()
        process.kill.assert_called_once_with()
        self.assertIsNone(engine.process)


if __name__ == "__main__":
    unittest.main()
