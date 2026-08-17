"""Deterministic contract tests for the Nemotron adapter."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from engines.base import EngineError
from engines.nemotron_asr import NemotronAsrEngine, _await_cleanup, _canonical, _multipart
from engines.registry import EngineConfigurationError


class FakeProcess:
    next_pid = 4000

    def __init__(self, command, **kwargs):
        self.command, self.kwargs = command, kwargs
        self.pid = FakeProcess.next_pid; FakeProcess.next_pid += 1
        self.returncode = None
        self.term_calls = self.kill_calls = 0
        self.wait_calls = []

    def poll(self): return self.returncode
    def wait(self, timeout=None):
        self.wait_calls.append(timeout)
        if self.returncode is None:
            self.returncode = 0
        return self.returncode
    def terminate(self): self.term_calls += 1
    def kill(self): self.kill_calls += 1


class EscalatingProcess(FakeProcess):
    def wait(self, timeout=None):
        self.wait_calls.append(timeout)
        if len(self.wait_calls) < 3:
            raise __import__("subprocess").TimeoutExpired(self.command, timeout)
        self.returncode = -9
        return self.returncode

    def terminate(self):
        self.term_calls += 1

    def kill(self):
        self.kill_calls += 1


class NemotronTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.binary = self.root / "nemotron"; self.binary.write_bytes(b"x"); self.binary.chmod(0o700)
        self.model = self.root / "model.gguf"; self.model.write_bytes(b"x"); self.model.chmod(0o600)
        self.libs = self.root / "lib"; self.libs.mkdir(); self.libs.chmod(0o700)
        self.profile = SimpleNamespace(model="nemotron-model", config={
            "executable": str(self.binary), "model_path": str(self.model),
            "library_paths": [str(self.libs)], "conversion_timeout_seconds": 5,
            "inference_timeout_seconds": 5,
        })

    def multipart(self, audio=b"FLAC", *, extras=()):
        boundary = b"----deterministic"
        parts = [
            (b'model', b'nemotron-model', b''),
            (b'response_format', b'verbose_json', b''),
            *extras,
            (b'file', audio, b'; filename="x.flac"\r\nContent-Type: audio/flac'),
        ]
        body = b''.join(b'--' + boundary + b'\r\nContent-Disposition: form-data; name="' + name + b'"' + extra + b'\r\n\r\n' + data + b'\r\n' for name, data, extra in parts) + b'--' + boundary + b'--\r\n'
        return body, 'multipart/form-data; boundary=----deterministic'

    def engine(self):
        return NemotronAsrEngine(self.profile, self.root / "scratch")

    def test_strict_config_contract_and_safe_dyld_environment(self):
        engine = self.engine()
        self.assertEqual(engine.model, "nemotron-model")
        for bad in ({"executable": str(self.binary)}, {**self.profile.config, "unknown": 1}, {**self.profile.config, "library_paths": []}, {**self.profile.config, "conversion_timeout_seconds": True}, {**self.profile.config, "executable": "relative"}):
            with self.subTest(bad=bad), self.assertRaises(EngineConfigurationError):
                NemotronAsrEngine(SimpleNamespace(model="x", config=bad), self.root / "scratch")
        with patch.dict(os.environ, {"SECRET": "must-not-pass", "PATH": "/safe"}, clear=True):
            with patch("engines.nemotron_asr.subprocess.Popen") as spawn:
                spawn.return_value = FakeProcess([])
                # A direct run is enough to inspect the bounded environment.
                asyncio.run(engine._run([str(self.binary)], 1, self.root))
        kwargs = spawn.call_args.kwargs
        self.assertEqual(kwargs["env"]["DYLD_LIBRARY_PATH"], str(self.libs))
        self.assertNotIn("SECRET", kwargs["env"])
        self.assertNotIn("start_new_session", kwargs)

    async def test_native_start_failure_is_detached_engine_start_error(self):
        engine = self.engine()
        with patch("engines.nemotron_asr.subprocess.Popen", side_effect=OSError("/secret/native")):
            with self.assertRaises(EngineError) as raised:
                await engine._run(["x"], 1, self.root)
        self.assertEqual(raised.exception.code, "engine_start_failed")
        self.assertIsNone(raised.exception.__cause__); self.assertIsNone(raised.exception.__context__)
        self.assertNotIn("secret", repr(raised.exception))

    async def test_transcribe_preserves_detached_native_start_error(self):
        body, content_type = self.multipart()
        with patch("engines.nemotron_asr._AFCONVERT", self.binary), patch(
            "engines.nemotron_asr.subprocess.Popen",
            side_effect=OSError("/secret/native"),
        ):
            with self.assertRaises(EngineError) as raised:
                await self.engine().transcribe(
                    payload=body,
                    content_type=content_type,
                    request_id="safe",
                )
        self.assertEqual(raised.exception.code, "engine_start_failed")
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)
        self.assertNotIn("secret", repr(raised.exception))

    def test_multipart_requires_nonempty_single_known_fields(self):
        body, ct = self.multipart(audio=b"")
        with self.assertRaises(ValueError):
            _multipart(body, ct, self.profile.model)
        duplicate = self.multipart(extras=[(b'prompt', b'a', b''), (b'prompt', b'b', b'')])
        with self.assertRaises(ValueError):
            _multipart(duplicate[0], duplicate[1], self.profile.model)

    def test_output_validation_exact_timing_overrun_zero_density_and_repetition(self):
        def doc(words, duration):
            return json.dumps({
                "file": "/private/source.wav",
                "text": "ignored upstream text",
                "confidence": 1,
                "duration": duration,
                "languages": ["en"],
                "words": words,
            }).encode()
        valid = [{"word": "hello", "start": 0, "end": 1, "confidence": 1}]
        output = json.loads(_canonical(doc(valid, 1)))
        self.assertEqual(output["language"], "en")
        self.assertEqual(output["segments"][0]["text"], "hello")
        self.assertNotIn("file", output)
        self.assertEqual(json.loads(_canonical(doc([{**valid[0], "end": 3}], 1)))["duration"], 1)
        with self.assertRaises(ValueError):
            _canonical(doc([{**valid[0], "end": 3.01}], 1))
        too_many_zero = [{"word": str(i), "start": 0, "end": 0, "confidence": 1} for i in range(9)]
        with self.assertRaises(ValueError): _canonical(doc(too_many_zero, 1))
        repeated = [{"word": "a", "start": i, "end": i + .1, "confidence": 1} for i in range(20)]
        with self.assertRaises(ValueError): _canonical(doc(repeated, 20))
        unknown = json.loads(doc(valid, 1)); unknown["extra"] = True
        with self.assertRaises(ValueError): _canonical(json.dumps(unknown).encode())

    async def test_direct_child_term_kill_and_reap_are_bounded(self):
        engine = self.engine(); process = EscalatingProcess(["native"])
        with patch.object(engine, "_process", process):
            await engine.stop()
        self.assertEqual(process.term_calls, 1)
        self.assertEqual(process.kill_calls, 1)
        self.assertEqual(process.wait_calls, [1.0, 1.0, None])
        self.assertIsNone(engine._process)

    async def test_repeated_cancellation_waits_for_release_cleanup(self):
        engine = self.engine()
        entered = asyncio.Event(); release = asyncio.Event()
        async def blocked_release():
            entered.set(); await release.wait()
            async with engine._state_lock: engine._reserved = False
        engine._reserved = True
        owner = asyncio.create_task(_await_cleanup(blocked_release()))
        await entered.wait(); owner.cancel(); owner.cancel()
        self.assertFalse(owner.done()); release.set()
        release.set()
        self.assertTrue(await owner)
        self.assertEqual(engine.active_requests, 0)

    async def test_stop_settles_the_authoritative_active_child(self):
        engine = self.engine()
        process = FakeProcess(["native"])
        entered = threading.Event()
        released = threading.Event()

        def wait(timeout=None):
            process.wait_calls.append(timeout)
            entered.set()
            if not released.wait(1):
                raise TimeoutError("direct child was not terminated")
            process.returncode = -15
            return process.returncode

        def terminate():
            process.term_calls += 1
            released.set()

        process.wait = wait  # type: ignore[method-assign]
        process.terminate = terminate  # type: ignore[method-assign]
        with patch("engines.nemotron_asr.subprocess.Popen", return_value=process):
            run = asyncio.create_task(engine._run([str(self.binary)], 5, self.root))
            await asyncio.to_thread(entered.wait)
            await engine.stop()
            with self.assertRaises(ValueError):
                await run
        self.assertEqual(process.term_calls, 1)
        self.assertIsNone(engine._process)

    async def test_transcribe_cancellation_reaps_and_releases(self):
        body, ct = self.multipart()
        process = FakeProcess([]); process.returncode = None
        entered = threading.Event(); gate = threading.Event()
        def blocked_wait(timeout=None):
            entered.set(); gate.wait(); process.returncode = 0; return 0
        process.wait = blocked_wait  # type: ignore[method-assign]
        with patch("engines.nemotron_asr._AFCONVERT", self.binary), patch("engines.nemotron_asr.subprocess.Popen", return_value=process):
            task = asyncio.create_task(self.engine().transcribe(payload=body, content_type=ct, request_id="safe"))
            await asyncio.to_thread(entered.wait)
            task.cancel(); task.cancel(); gate.set()
            with self.assertRaises(asyncio.CancelledError): await task


if __name__ == "__main__": unittest.main()
