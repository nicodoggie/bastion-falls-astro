"""Strict loader for the machine-local remote-STT service configuration."""

from __future__ import annotations

import math
import re
import stat
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

import yaml


MAX_CONFIG_BYTES = 64 * 1024
MAX_MODELS = 32
MAX_MAPPING_ITEMS = 128
MAX_LIST_ITEMS = 128
MAX_NESTING_DEPTH = 16
MAX_IDENTIFIER_LENGTH = 64
MAX_MODEL_LENGTH = 512
MAX_STRING_LENGTH = 8 * 1024
_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


class ServiceConfigError(ValueError):
    """Raised when a service configuration is missing or violates its contract."""


@dataclass(frozen=True)
class ModelProfile:
    name: str
    engine: str
    model: str
    config: Mapping[str, object]


@dataclass(frozen=True)
class ServiceConfig:
    selected_model: str
    models: Mapping[str, ModelProfile]

    @property
    def selected(self) -> ModelProfile:
        return self.models[self.selected_model]


def _fail(message: str) -> ServiceConfigError:
    return ServiceConfigError(message)


class _UniqueKeySafeLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects ambiguous duplicate mapping keys."""


def _construct_unique_mapping(
    loader: _UniqueKeySafeLoader,
    node: yaml.MappingNode,
    deep: bool = False,
) -> dict[object, object]:
    loader.flatten_mapping(node)
    mapping: dict[object, object] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise yaml.constructor.ConstructorError(
                None,
                None,
                "mapping key is not hashable",
                key_node.start_mark,
            ) from exc
        if duplicate:
            raise yaml.constructor.ConstructorError(
                None,
                None,
                "duplicate mapping key",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeySafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise _fail(f"Invalid {label} identifier")
    return value


def _freeze_json_value(value: Any, *, depth: int = 0) -> object:
    if depth > MAX_NESTING_DEPTH:
        raise _fail("Configuration nesting is too deep")
    if isinstance(value, str):
        if len(value) > MAX_STRING_LENGTH:
            raise _fail("Configuration string is too long")
        return value
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _fail("Configuration contains a non-finite number")
        return value
    if isinstance(value, list):
        if len(value) > MAX_LIST_ITEMS:
            raise _fail("Configuration list is too large")
        return tuple(_freeze_json_value(item, depth=depth + 1) for item in value)
    if isinstance(value, dict):
        if len(value) > MAX_MAPPING_ITEMS:
            raise _fail("Configuration mapping is too large")
        frozen: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise _fail("Configuration mapping keys must be strings")
            if len(key) > MAX_IDENTIFIER_LENGTH:
                raise _fail("Configuration mapping key is too long")
            frozen[key] = _freeze_json_value(item, depth=depth + 1)
        return MappingProxyType(frozen)
    raise _fail("Configuration contains an unsupported YAML value")


def _read_bounded(path: Path) -> bytes:
    try:
        info = path.stat()
    except (OSError, ValueError) as exc:
        raise _fail("Configuration file is unavailable") from exc
    if not stat.S_ISREG(info.st_mode) or not (info.st_mode & stat.S_IRUSR):
        raise _fail("Configuration file must be an owner-readable regular file")
    if info.st_size > MAX_CONFIG_BYTES:
        raise _fail("Configuration file is too large")
    try:
        with path.open("rb") as stream:
            content = stream.read(MAX_CONFIG_BYTES + 1)
    except OSError as exc:
        raise _fail("Configuration file is unreadable") from exc
    if len(content) > MAX_CONFIG_BYTES:
        raise _fail("Configuration file is too large")
    return content


def _require_keys(mapping: dict[Any, Any], expected: set[str], label: str) -> None:
    keys = tuple(mapping)
    if any(not isinstance(key, str) for key in keys) or set(keys) != expected:
        raise _fail(f"{label} has unknown or missing keys")


def load_service_config(path: Path) -> ServiceConfig:
    """Load and validate one bounded YAML service configuration."""
    content = _read_bounded(Path(path))
    try:
        document = yaml.load(content, Loader=_UniqueKeySafeLoader)
    except yaml.YAMLError as exc:
        raise _fail("Configuration YAML is malformed") from exc

    if not isinstance(document, dict):
        raise _fail("Configuration root must be a mapping")
    if len(document) > MAX_MAPPING_ITEMS:
        raise _fail("Configuration mapping is too large")
    _require_keys(document, {"selected_model", "models"}, "Configuration root")

    selected_model = _identifier(document["selected_model"], "selected model")
    raw_models = document["models"]
    if not isinstance(raw_models, dict):
        raise _fail("models must be a mapping")
    if not raw_models or len(raw_models) > MAX_MODELS:
        raise _fail("models must contain between one and the model limit profiles")

    profiles: dict[str, ModelProfile] = {}
    for raw_name, raw_profile in raw_models.items():
        name = _identifier(raw_name, "profile")
        if not isinstance(raw_profile, dict):
            raise _fail(f"Profile {name} must be a mapping")
        _require_keys(raw_profile, {"engine", "model", "config"}, f"Profile {name}")
        engine = _identifier(raw_profile["engine"], "engine")
        model = raw_profile["model"]
        if not isinstance(model, str) or not model or len(model) > MAX_MODEL_LENGTH:
            raise _fail(f"Profile {name} has an invalid model")
        raw_config = raw_profile["config"]
        if not isinstance(raw_config, dict):
            raise _fail(f"Profile {name} config must be a mapping")
        config = _freeze_json_value(raw_config)
        if not isinstance(config, MappingProxyType):
            raise _fail(f"Profile {name} config must be a mapping")
        profiles[name] = ModelProfile(name, engine, model, config)

    if selected_model not in profiles:
        raise _fail("selected_model does not name a configured profile")
    return ServiceConfig(selected_model, MappingProxyType(profiles))
