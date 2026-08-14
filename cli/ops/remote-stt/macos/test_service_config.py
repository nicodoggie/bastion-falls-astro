import os
import tempfile
import unittest
from pathlib import Path
from types import MappingProxyType

from service_config import (
    MAX_CONFIG_BYTES,
    MAX_STRING_LENGTH,
    ServiceConfigError,
    load_service_config,
)


ROOT = Path(__file__).parent
EXAMPLE = ROOT / "config.example.yaml"


class ServiceConfigTests(unittest.TestCase):
    def write_config(self, content: str | bytes) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "service.yaml"
        path.write_bytes(content.encode() if isinstance(content, str) else content)
        return path

    def test_example_selects_the_mlx_whisper_profile(self):
        config = load_service_config(EXAMPLE)

        self.assertEqual(config.selected_model, "whisper_turbo")
        self.assertEqual(config.selected.name, "whisper_turbo")
        self.assertEqual(config.selected.engine, "mlx-whisper")
        self.assertEqual(config.selected.model, "mlx-community/whisper-large-v3-turbo")
        self.assertEqual(config.selected.config, {})

    def test_rejects_missing_or_oversized_config(self):
        with self.assertRaises(ServiceConfigError):
            load_service_config(ROOT / "does-not-exist.yaml")

        path = self.write_config("x" * (MAX_CONFIG_BYTES + 1))
        with self.assertRaises(ServiceConfigError):
            load_service_config(path)

    def test_rejects_non_regular_or_unreadable_config(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        directory_path = Path(directory.name)
        with self.assertRaises(ServiceConfigError):
            load_service_config(directory_path)

        path = self.write_config("selected_model: x\nmodels: {}\n")
        path.chmod(0)
        try:
            with self.assertRaises(ServiceConfigError):
                load_service_config(path)
        finally:
            path.chmod(0o600)

    def test_rejects_malformed_yaml_and_non_mapping_root(self):
        for content in ("selected_model: [\n", "- selected_model\n- models\n", "null\n"):
            with self.subTest(content=content):
                with self.assertRaises(ServiceConfigError):
                    load_service_config(self.write_config(content))

    def test_rejects_duplicate_mapping_keys_at_every_level(self):
        cases = (
            "selected_model: one\nselected_model: two\nmodels: {}\n",
            "selected_model: one\nmodels:\n  one:\n"
            "    engine: first\n    engine: second\n    model: model\n    config: {}\n",
            "selected_model: one\nmodels:\n  one:\n"
            "    engine: engine\n    model: model\n    config:\n      mode: first\n      mode: second\n",
        )
        for content in cases:
            with self.subTest(content=content):
                with self.assertRaises(ServiceConfigError):
                    load_service_config(self.write_config(content))

    def test_rejects_oversized_nested_string(self):
        path = self.write_config(
            "selected_model: one\nmodels:\n  one:\n"
            "    engine: engine\n    model: model\n    config:\n"
            f"      prompt: {'x' * (MAX_STRING_LENGTH + 1)}\n"
        )
        with self.assertRaises(ServiceConfigError):
            load_service_config(path)

    def test_rejects_unknown_shared_keys(self):
        path = self.write_config(
            "selected_model: whisper_turbo\nmodels: {}\nunexpected: true\n"
        )
        with self.assertRaises(ServiceConfigError):
            load_service_config(path)

    def test_rejects_unknown_selected_model(self):
        path = self.write_config(
            "selected_model: missing\nmodels:\n  whisper_turbo:\n"
            "    engine: mlx-whisper\n    model: model\n    config: {}\n"
        )
        with self.assertRaises(ServiceConfigError):
            load_service_config(path)

    def test_preserves_dormant_adapter_config_without_loading_it(self):
        path = self.write_config(
            "selected_model: whisper_turbo\nmodels:\n"
            "  whisper_turbo:\n"
            "    engine: mlx-whisper\n"
            "    model: model\n"
            "    config: &shared\n"
            "      endpoint: http://localhost\n"
            "      options: [fast, accurate]\n"
            "  dormant:\n"
            "    engine: future-engine\n"
            "    model: future-model\n"
            "    config: *shared\n"
        )

        config = load_service_config(path)

        self.assertEqual(config.models["dormant"].engine, "future-engine")
        self.assertEqual(
            config.models["dormant"].config,
            {"endpoint": "http://localhost", "options": ("fast", "accurate")},
        )
        self.assertIsInstance(config.models["dormant"].config, MappingProxyType)
        with self.assertRaises(TypeError):
            config.models["dormant"].config["endpoint"] = "changed"
        with self.assertRaises(TypeError):
            config.models["dormant"].config["options"] = []

    def test_value_objects_and_nested_config_are_immutable(self):
        config = load_service_config(
            self.write_config(
                "selected_model: whisper_turbo\nmodels:\n"
                "  whisper_turbo:\n"
                "    engine: mlx-whisper\n    model: model\n"
                "    config:\n      nested:\n        values: [one]\n"
            )
        )

        with self.assertRaises(AttributeError):
            config.selected_model = "other"
        with self.assertRaises(TypeError):
            config.models["other"] = config.selected
        with self.assertRaises(TypeError):
            config.selected.config["nested"] = {}
        with self.assertRaises(TypeError):
            config.selected.config["nested"]["values"] = []

    def test_rejects_unsupported_yaml_values_and_invalid_shapes(self):
        cases = (
            "selected_model: true\nmodels: {}\n",
            "selected_model: whisper_turbo\nmodels: []\n",
            "selected_model: whisper_turbo\nmodels:\n  whisper_turbo: []\n",
            "selected_model: whisper_turbo\nmodels:\n  whisper_turbo:\n"
            "    engine: mlx-whisper\n    model: model\n    config: !!python/object:__main__.X {}\n",
        )
        for content in cases:
            with self.subTest(content=content):
                with self.assertRaises(ServiceConfigError):
                    load_service_config(self.write_config(content))


if __name__ == "__main__":
    unittest.main()
