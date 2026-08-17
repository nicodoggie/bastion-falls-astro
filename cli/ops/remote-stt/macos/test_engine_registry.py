import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from engines.base import EngineError, EngineResult, InferenceEngine
from engines.registry import (
    EngineConfigurationError,
    _ENGINE_REGISTRY,
    create_engine,
)


ROOT = Path(__file__).parent


class FakeEngine:
    name = "fake"
    model = "fake-model"
    running = False
    active_requests = 0

    async def transcribe(self, *, payload, content_type, request_id):
        return EngineResult(payload, 200, content_type)

    async def stop(self):
        return None

    async def reap_loop(self):
        return None


class RaisingRunningEngine(FakeEngine):
    @property
    def running(self):
        raise RuntimeError("secret-property")


class EngineRegistryTests(unittest.TestCase):
    def profile(self, engine="mlx-whisper"):
        return SimpleNamespace(engine=engine, model="model", config={})

    def test_mlx_whisper_resolves_one_lazy_registered_factory(self):
        fake = FakeEngine()
        with patch.dict(
            _ENGINE_REGISTRY,
            {"mlx-whisper": ("engines.fake_mlx", "create_engine")},
            clear=True,
        ) as registry:
            with patch("engines.registry.importlib.import_module") as importer:
                importer.return_value.create_engine.return_value = fake
                result = create_engine(self.profile(), ROOT)

        self.assertIs(result, fake)
        importer.assert_called_once_with("engines.fake_mlx")
        importer.return_value.create_engine.assert_called_once_with(
            self.profile(), ROOT
        )
        self.assertIn("mlx-whisper", registry)

    def test_unknown_engine_raises_fixed_bounded_configuration_error(self):
        with self.assertRaises(EngineConfigurationError) as raised:
            create_engine(self.profile("unknown-engine"), ROOT)

        self.assertEqual(str(raised.exception), "Unknown inference engine")
        self.assertLessEqual(len(str(raised.exception)), 64)

    def test_unknown_engine_never_falls_back_to_mlx(self):
        with patch("engines.registry.importlib.import_module") as importer:
            with self.assertRaises(EngineConfigurationError):
                create_engine(self.profile("not-registered"), ROOT)
        importer.assert_not_called()

    def test_unavailable_engine_error_does_not_retain_import_failure(self):
        with patch(
            "engines.registry.importlib.import_module",
            side_effect=ImportError("provider secret"),
        ):
            with self.assertRaises(EngineConfigurationError) as raised:
                create_engine(self.profile(), ROOT)

        self.assertEqual(str(raised.exception), "Engine unavailable")
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)

    def test_arbitrary_import_failures_are_fixed_bounded_and_detached(self):
        failures = (
            RuntimeError("provider secret"),
            OSError("native loader secret"),
            Exception("native-loader detail"),
        )
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                with patch(
                    "engines.registry.importlib.import_module",
                    side_effect=failure,
                ):
                    with self.assertRaises(EngineConfigurationError) as raised:
                        create_engine(self.profile(), ROOT)

                error = raised.exception
                self.assertEqual(error.args, ("Engine unavailable",))
                self.assertEqual(str(error), "Engine unavailable")
                self.assertIsNone(error.__cause__)
                self.assertIsNone(error.__context__)
                self.assertNotIn(str(failure), repr(error))
                self.assertNotIn(str(failure), repr(vars(error)))

    def test_imports_are_isolated_in_a_fresh_subprocess(self):
        code = """
import json
import sys
sys.path.insert(0, %r)
before = set(sys.modules)
import engines.base
import engines.registry
after = set(sys.modules)
print(json.dumps({
    'mlx': 'engines.mlx_whisper' in after,
    'subprocess': 'subprocess' in after - before,
    'model': bool({'mlx', 'mlx_whisper', 'torch', 'transformers'} & (after - before)),
}))
""" % str(ROOT)
        completed = subprocess.run(
            [sys.executable, "-c", code],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            json.loads(completed.stdout),
            {"mlx": False, "subprocess": False, "model": False},
        )

    def test_dormant_unregistered_profile_is_harmless_until_selected(self):
        dormant = self.profile("future-engine")
        self.assertEqual(dormant.engine, "future-engine")
        with self.assertRaises(EngineConfigurationError):
            create_engine(dormant, ROOT)

    def test_factory_exception_is_fixed_bounded_and_has_no_exception_chain(self):
        with patch.dict(
            _ENGINE_REGISTRY,
            {"mlx-whisper": ("engines.fake_mlx", "create_engine")},
            clear=True,
        ):
            with patch("engines.registry.importlib.import_module") as importer:
                importer.return_value.create_engine.side_effect = RuntimeError(
                    "provider detail"
                )
                with self.assertRaises(EngineConfigurationError) as raised:
                    create_engine(self.profile(), ROOT)

        self.assertEqual(str(raised.exception), "Engine unavailable")
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)

    def test_factory_configuration_error_is_fixed_bounded_and_detached(self):
        marker = "provider detail /secret/path"
        with patch.dict(
            _ENGINE_REGISTRY,
            {"mlx-whisper": ("engines.fake_mlx", "create_engine")},
            clear=True,
        ):
            with patch("engines.registry.importlib.import_module") as importer:
                importer.return_value.create_engine.side_effect = (
                    EngineConfigurationError(marker)
                )
                with self.assertRaises(EngineConfigurationError) as raised:
                    create_engine(self.profile(), ROOT)

        error = raised.exception
        self.assertEqual(error.args, ("Invalid engine configuration",))
        self.assertEqual(str(error), "Invalid engine configuration")
        self.assertLessEqual(len(str(error)), 64)
        self.assertIsNone(error.__cause__)
        self.assertIsNone(error.__context__)
        self.assertNotIn(marker, repr(error))
        self.assertNotIn(marker, str(error))
        self.assertNotIn(marker, repr(vars(error)))

    def test_factory_result_must_satisfy_runtime_protocol(self):
        with patch.dict(
            _ENGINE_REGISTRY,
            {"mlx-whisper": ("engines.fake_mlx", "create_engine")},
            clear=True,
        ):
            with patch("engines.registry.importlib.import_module") as importer:
                importer.return_value.create_engine.return_value = object()
                with self.assertRaises(EngineConfigurationError) as raised:
                    create_engine(self.profile(), ROOT)

        self.assertEqual(str(raised.exception), "Engine factory returned invalid adapter")

    def test_runtime_validation_exception_is_fixed_and_detached(self):
        marker = "secret-property"
        with patch.dict(
            _ENGINE_REGISTRY,
            {"mlx-whisper": ("engines.fake_mlx", "create_engine")},
            clear=True,
        ):
            with patch("engines.registry.importlib.import_module") as importer:
                importer.return_value.create_engine.return_value = RaisingRunningEngine()
                with self.assertRaises(EngineConfigurationError) as raised:
                    create_engine(self.profile(), ROOT)

        error = raised.exception
        self.assertEqual(error.args, ("Engine factory returned invalid adapter",))
        self.assertNotIn(marker, str(error))
        self.assertNotIn(marker, repr(error))
        self.assertNotIn(marker, repr(vars(error)))
        self.assertIsNone(error.__cause__)
        self.assertIsNone(error.__context__)

    def test_protocol_is_runtime_checkable_and_result_is_frozen(self):
        self.assertIsInstance(FakeEngine(), InferenceEngine)
        result = EngineResult(b"audio", 200, "audio/wav")
        self.assertEqual(result.process_time_ms, None)
        with self.assertRaises(AttributeError):
            result.content = b"changed"

    def test_engine_error_has_only_fixed_codes_and_message(self):
        for code in (
            "engine_start_failed",
            "engine_unavailable",
            "engine_inference_failed",
        ):
            error = EngineError(code)
            self.assertEqual(error.code, code)
            self.assertEqual(str(error), code)
        with self.assertRaises(ValueError):
            EngineError("provider-secret")


if __name__ == "__main__":
    unittest.main()
