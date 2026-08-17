"""Engine-neutral runtime contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable


EngineErrorCode = Literal[
    "engine_start_failed",
    "engine_unavailable",
    "engine_inference_failed",
]


@dataclass(frozen=True)
class EngineResult:
    content: bytes
    status_code: int
    media_type: str | None
    process_time_ms: str | None = None


class EngineError(Exception):
    """A provider-independent, deliberately bounded engine failure."""

    code: EngineErrorCode

    def __init__(self, code: EngineErrorCode) -> None:
        if code not in {
            "engine_start_failed",
            "engine_unavailable",
            "engine_inference_failed",
        }:
            raise ValueError("invalid engine error code")
        self.code = code
        super().__init__(code)


@runtime_checkable
class InferenceEngine(Protocol):
    name: str
    model: str

    @property
    def running(self) -> bool: ...

    @property
    def active_requests(self) -> int: ...

    async def transcribe(
        self,
        *,
        payload: bytes,
        content_type: str,
        request_id: str,
    ) -> EngineResult: ...

    async def stop(self) -> None: ...

    async def reap_loop(self) -> None: ...
