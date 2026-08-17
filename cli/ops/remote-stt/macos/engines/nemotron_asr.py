"""Bounded, single-flight adapter for the native Nemotron CLI."""
from __future__ import annotations

import asyncio
import email.policy
import email.parser
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
import wave
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .base import EngineError, EngineResult
from .registry import EngineConfigurationError

_MAX_BODY = 64 * 1024 * 1024
_MAX_AUDIO = 129 * 1024 * 1024
_MAX_OUTPUT = 8 * 1024 * 1024
_MAX_WORDS = 250_000
_MAX_ZERO_DURATION = 8
_MAX_DENSITY = 100.0
_MAX_OVERRUN = 2.0
_AFCONVERT = Path("/usr/bin/afconvert")
_ALLOWED_CONFIG = {"executable", "model_path", "library_paths", "conversion_timeout_seconds", "inference_timeout_seconds"}
_SAFE_ENV = {"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"}


def _inference_error() -> EngineError:
    return EngineError("engine_inference_failed")


def _start_error() -> EngineError:
    return EngineError("engine_start_failed")


def _invalid_config() -> EngineConfigurationError:
    return EngineConfigurationError("Invalid engine configuration")


def _timeout(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _invalid_config()
    value = float(value)
    if not math.isfinite(value) or not 0 < value <= 3600:
        raise _invalid_config()
    return value


def _owner_path(value: object, *, executable: bool, directory: bool = False) -> Path:
    if not isinstance(value, (str, os.PathLike)):
        raise _invalid_config()
    path = Path(value)
    try:
        if not path.is_absolute() or path.is_symlink() or path.stat().st_uid != os.getuid():
            raise ValueError
        if directory:
            valid = path.is_dir() and os.access(path, os.R_OK | os.X_OK)
        else:
            valid = path.is_file() and os.access(path, os.R_OK) and (not executable or os.access(path, os.X_OK))
        if not valid:
            raise ValueError
    except (OSError, ValueError):
        raise _invalid_config()
    return path


def _config(profile: Any) -> tuple[Path, Path, tuple[Path, ...], float, float]:
    cfg = getattr(profile, "config", None)
    if not isinstance(cfg, Mapping) or set(cfg) != _ALLOWED_CONFIG:
        raise _invalid_config()
    executable = _owner_path(cfg["executable"], executable=True)
    model = _owner_path(cfg["model_path"], executable=False)
    paths = cfg["library_paths"]
    if isinstance(paths, (str, bytes)) or not isinstance(paths, (list, tuple)) or not paths:
        raise _invalid_config()
    libraries = tuple(_owner_path(item, executable=False, directory=True) for item in paths)
    return executable, model, libraries, _timeout(cfg["conversion_timeout_seconds"]), _timeout(cfg["inference_timeout_seconds"])


def _safe_environment(libraries: tuple[Path, ...]) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in _SAFE_ENV}
    env["DYLD_LIBRARY_PATH"] = os.pathsep.join(str(path) for path in libraries)
    return env


def _multipart(payload: bytes, content_type: str, model: str) -> bytes:
    if not isinstance(payload, bytes) or not 0 < len(payload) <= _MAX_BODY or not isinstance(content_type, str) or any(c in content_type for c in "\r\n"):
        raise ValueError
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + payload
    msg = email.parser.BytesParser(policy=email.policy.default).parsebytes(header)
    if msg.get_content_type() != "multipart/form-data" or not msg.is_multipart() or any(part.is_multipart() for part in msg.iter_parts()):
        raise ValueError
    fields: dict[str, list[bytes]] = {}
    audio: bytes | None = None
    for part in msg.iter_parts():
        disposition = dict(part.get_params(header="content-disposition", unquote=True) or [])
        name = disposition.get("name")
        data = part.get_payload(decode=True)
        if not name or not isinstance(data, bytes) or part.get("Content-Transfer-Encoding"):
            raise ValueError
        if name == "file":
            if audio is not None or not disposition.get("filename") or part.get_content_type() not in {"audio/flac", "audio/x-flac"} or not data:
                raise ValueError
            audio = data
        else:
            fields.setdefault(name, []).append(data)
    if audio is None or any(len(values) != 1 for values in fields.values()):
        raise ValueError
    if set(fields) != {"model", "response_format"} and not set(fields).issubset({"model", "response_format", "language", "prompt"}):
        raise ValueError
    if set(fields) < {"model", "response_format"}:
        raise ValueError
    try:
        if fields["model"][0].decode("utf-8") != model:
            raise ValueError
    except UnicodeDecodeError:
        raise ValueError
    if fields["response_format"][0] != b"verbose_json":
        raise ValueError
    if len(fields["model"][0]) > 256 or len(fields.get("language", [b""])[0]) > 256 or len(fields.get("prompt", [b""])[0]) > 8192:
        raise ValueError
    return audio


def _word(value: object) -> tuple[str, float, float, float]:
    if not isinstance(value, Mapping) or set(value) != {"word", "start", "end", "confidence"}:
        raise ValueError
    text = value["word"]
    if not isinstance(text, str) or not text or len(text.encode()) > 256:
        raise ValueError
    values = [value[key] for key in ("start", "end", "confidence")]
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)) for item in values):
        raise ValueError
    start, end, confidence = map(float, values)
    if start < 0 or end < start or confidence < 0 or confidence > 1:
        raise ValueError
    return text, start, end, confidence


def _repetition(words: list[str]) -> None:
    normalized = [re.sub(r"\s+", " ", word.casefold()).strip() for word in words]
    for size in range(1, min(8, len(normalized)) + 1):
        for start in range(len(normalized) - size * 20 + 1):
            block = normalized[start : start + size]
            if all(normalized[start + n * size : start + (n + 1) * size] == block for n in range(20)):
                raise ValueError


def _join(words: list[str]) -> str:
    result = ""
    no_space_before = set(".,!?;:%)]}")
    for word in words:
        if not result or word[:1] in no_space_before or result[-1:] in "([{":
            result += word
        else:
            result += " " + word
    return result


def _segment(items: list[tuple[str, float, float, float]]) -> dict[str, object]:
    return {"start": items[0][1], "end": items[-1][2], "text": _join([item[0] for item in items]), "confidence": sum(item[3] for item in items) / len(items)}


def _canonical(raw: bytes) -> bytes:
    if not 0 < len(raw) <= _MAX_OUTPUT:
        raise ValueError
    obj = json.loads(raw.decode("utf-8"))
    expected = {"file", "text", "confidence", "duration", "languages", "words"}
    if not isinstance(obj, dict) or set(obj) != expected:
        raise ValueError
    source_file = obj["file"]
    text = obj["text"]
    confidence = obj["confidence"]
    languages = obj["languages"]
    if not isinstance(source_file, str) or len(source_file.encode()) > 4096:
        raise ValueError
    if not isinstance(text, str) or len(text.encode()) > 4 * 1024 * 1024:
        raise ValueError
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not math.isfinite(float(confidence)) or not 0 <= float(confidence) <= 1:
        raise ValueError
    if not isinstance(languages, list) or not 0 < len(languages) <= 16 or any(not isinstance(item, str) or len(item.encode()) > 64 for item in languages):
        raise ValueError
    if not isinstance(obj["words"], list) or not obj["words"] or len(obj["words"]) > _MAX_WORDS:
        raise ValueError
    duration = obj.get("duration")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(float(duration)) or duration < 0:
        raise ValueError
    words = [_word(item) for item in obj["words"]]
    zero_duration = sum(start == end for _, start, end, _ in words)
    if zero_duration > _MAX_ZERO_DURATION:
        raise ValueError
    if any(words[i][1] > words[i + 1][1] or words[i][2] > words[i + 1][2] for i in range(len(words) - 1)):
        raise ValueError
    if words[-1][2] > float(duration) + _MAX_OVERRUN:
        raise ValueError
    if duration == 0 or len(words) / max(float(duration), 0.001) > _MAX_DENSITY:
        raise ValueError
    _repetition([item[0] for item in words])
    segments: list[dict[str, object]] = []
    current: list[tuple[str, float, float, float]] = []
    for item in words:
        if current and (current[-1][0][-1:] in ".,!?;:%)]}" or item[1] - current[-1][2] >= 1.2 or len(current) >= 40 or item[2] - current[0][1] >= 15):
            segments.append(_segment(current)); current = []
        current.append(item)
    if current:
        segments.append(_segment(current))
    result = {"segments": segments, "language": "en", "duration": float(duration)}
    return json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()


def _ensure_owned_dir(path: Path) -> None:
    try:
        if path.exists():
            if path.is_symlink() or not path.is_dir() or path.stat().st_uid != os.getuid():
                raise ValueError
        else:
            path.mkdir(mode=0o700)
        os.chmod(path, 0o700)
    except (OSError, ValueError):
        raise ValueError


def _normalize_wav(source: Path, output: Path) -> None:
    if not source.is_file() or source.is_symlink() or source.stat().st_size > _MAX_AUDIO:
        raise ValueError
    try:
        with wave.open(str(source), "rb") as reader:
            if (reader.getnchannels(), reader.getsampwidth(), reader.getframerate(), reader.getcomptype()) != (1, 2, 16000, "NONE"):
                raise ValueError
            frames = reader.getnframes()
            fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle, wave.open(handle, "wb") as writer:
                writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(16000)
                writer.writeframes(reader.readframes(frames))
    except (OSError, EOFError, wave.Error):
        raise ValueError


class NemotronAsrEngine:
    name = "nemotron-asr"

    def __init__(self, profile: Any, service_root: Path) -> None:
        self.model = profile.model
        self.service_root = Path(service_root)
        self.executable, self.model_path, self.library_paths, self.conversion_timeout, self.inference_timeout = _config(profile)
        self._state_lock = asyncio.Lock()
        self._lifecycle_lock = asyncio.Lock()
        self._process: subprocess.Popen[bytes] | None = None
        self._reserved = False

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    @property
    def active_requests(self) -> int:
        return int(self._reserved)

    async def transcribe(self, *, payload: bytes, content_type: str, request_id: str) -> EngineResult:
        async with self._state_lock:
            if self._reserved:
                raise _inference_error()
            self._reserved = True
        temp: Path | None = None
        cancelled = False
        failure_code: str | None = None
        started = time.monotonic()
        try:
            audio = _multipart(payload, content_type, self.model)
            requests = self.service_root / "requests"
            _ensure_owned_dir(self.service_root)
            _ensure_owned_dir(requests)
            temp = Path(tempfile.mkdtemp(prefix="req-", dir=requests)); os.chmod(temp, 0o700)
            input_flac, intermediate, input_wav, output = (temp / name for name in ("input.flac", "intermediate.wav", "input.wav", "result.json"))
            fd = os.open(input_flac, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(audio)
            await self._run([str(_AFCONVERT), str(input_flac), str(intermediate), "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"], self.conversion_timeout, temp)
            _normalize_wav(intermediate, input_wav)
            cmd = [str(self.executable), "transcribe", str(input_wav), "--model", str(self.model_path), "--device", "metal", "--format", "json", "--output", str(output), "--word-times", "--force"]
            await self._run(cmd, self.inference_timeout, temp)
            if not output.is_file() or output.stat().st_size > _MAX_OUTPUT:
                raise ValueError
            return EngineResult(_canonical(output.read_bytes()), 200, "application/json", str(int((time.monotonic() - started) * 1000)))
        except asyncio.CancelledError:
            cancelled = True
        except EngineError as exc:
            failure_code = exc.code
        except Exception as exc:
            del exc
            failure_code = "engine_inference_failed"
        finally:
            try:
                cancelled = await _await_cleanup(self._cleanup_process()) or cancelled
            except Exception:
                if failure_code is None and not cancelled:
                    failure_code = "engine_inference_failed"
            if temp is not None:
                shutil.rmtree(temp, ignore_errors=True)
            try:
                cancelled = await _await_cleanup(self._release()) or cancelled
            except Exception:
                if failure_code is None and not cancelled:
                    failure_code = "engine_inference_failed"
        if cancelled:
            raise asyncio.CancelledError
        if failure_code is not None:
            raise EngineError(failure_code) from None
        raise AssertionError("unreachable")

    async def _run(self, command: list[str], timeout: float, cwd: Path) -> None:
        process: subprocess.Popen[bytes] | None = None
        async with self._lifecycle_lock:
            try:
                process = subprocess.Popen(
                    command,
                    cwd=cwd,
                    env=_safe_environment(self.library_paths),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except (OSError, ValueError):
                pass
            if process is not None:
                async with self._state_lock:
                    self._process = process
        if process is None:
            raise _start_error() from None
        try:
            await asyncio.to_thread(process.wait, timeout=timeout)
        except (subprocess.TimeoutExpired, asyncio.CancelledError):
            raise
        if process.returncode != 0:
            raise ValueError

    async def _release(self) -> None:
        async with self._state_lock:
            self._reserved = False

    async def _cleanup_process(self) -> None:
        async with self._lifecycle_lock:
            async with self._state_lock:
                process = self._process
            if process is None:
                return
            try:
                if process.poll() is None:
                    try:
                        process.terminate()
                    except ProcessLookupError:
                        pass
                    try:
                        await asyncio.to_thread(process.wait, timeout=1.0)
                    except subprocess.TimeoutExpired:
                        try:
                            process.kill()
                        except ProcessLookupError:
                            pass
                        try:
                            await asyncio.to_thread(process.wait, timeout=1.0)
                        except subprocess.TimeoutExpired:
                            await asyncio.to_thread(process.wait)
            finally:
                async with self._state_lock:
                    if self._process is process:
                        self._process = None

    async def stop(self) -> None:
        await _await_cleanup(self._cleanup_process())

    async def reap_loop(self) -> None:
        await asyncio.Event().wait()


async def _await_cleanup(awaitable: Any) -> bool:
    task = asyncio.ensure_future(awaitable)
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    task.result()
    return cancelled


def create_engine(profile: Any, service_root: Path) -> NemotronAsrEngine:
    return NemotronAsrEngine(profile, service_root)
