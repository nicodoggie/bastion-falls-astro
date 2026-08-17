"""Fail-closed lazy construction of inference engine adapters."""

from __future__ import annotations

import importlib
import inspect
from pathlib import Path
from typing import Any

from .base import InferenceEngine


class EngineConfigurationError(ValueError):
    """Raised for bounded engine-selection or adapter-shape failures."""


_ENGINE_REGISTRY: dict[str, tuple[str, str]] = {
    "mlx-whisper": ("engines.mlx_whisper", "create_engine"),
    "nemotron-asr": ("engines.nemotron_asr", "create_engine"),
}


def _invalid_adapter() -> EngineConfigurationError:
    return EngineConfigurationError("Engine factory returned invalid adapter")


def _valid_adapter(adapter: Any) -> bool:
    if not isinstance(adapter, InferenceEngine):
        return False
    if not isinstance(getattr(adapter, "name", None), str):
        return False
    if not isinstance(getattr(adapter, "model", None), str):
        return False
    if not isinstance(getattr(adapter, "running", None), bool):
        return False
    if not isinstance(getattr(adapter, "active_requests", None), int):
        return False
    return all(
        inspect.iscoroutinefunction(getattr(adapter, method, None))
        for method in ("transcribe", "stop", "reap_loop")
    )


def create_engine(profile: Any, service_root: Path) -> InferenceEngine:
    """Resolve and construct only the adapter selected by ``profile``."""
    entry = _ENGINE_REGISTRY.get(profile.engine)
    if entry is None:
        raise EngineConfigurationError("Unknown inference engine")

    module_name, factory_name = entry
    unavailable = False
    factory: Any = None
    try:
        module = importlib.import_module(module_name)
        factory = getattr(module, factory_name)
    except Exception:
        unavailable = True
    if unavailable:
        # Raise after leaving the handler so the provider exception is not
        # retained as either ``__cause__`` or ``__context__``.
        raise EngineConfigurationError("Engine unavailable")

    adapter: Any = None
    invalid_configuration = False
    try:
        adapter = factory(profile, service_root)
    except EngineConfigurationError:
        invalid_configuration = True
    except Exception:
        unavailable = True

    if invalid_configuration:
        # Raise after leaving the handler so the provider exception is not
        # retained as either ``__cause__`` or ``__context__``.
        raise EngineConfigurationError("Invalid engine configuration")
    if unavailable:
        # Raise after leaving the handler so the provider exception is not
        # retained as either ``__cause__`` or ``__context__``.
        raise EngineConfigurationError("Engine unavailable")

    adapter_valid = False
    try:
        adapter_valid = _valid_adapter(adapter)
    except Exception:
        # Raise after leaving the handler so the adapter exception is not
        # retained as either ``__cause__`` or ``__context__``.
        adapter_valid = False

    if not adapter_valid:
        raise _invalid_adapter()
    return adapter
