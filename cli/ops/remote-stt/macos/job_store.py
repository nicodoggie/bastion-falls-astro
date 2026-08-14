import os
import re
import sqlite3
import time
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path


_IDEMPOTENCY_KEY = re.compile(r"^[0-9a-f]{64}$")
_JOB_ID = re.compile(r"^[0-9a-f]{32}$")
_TERMINAL_STATUSES = ("succeeded", "failed")


@dataclass(frozen=True)
class JobRecord:
    id: str
    idempotency_key: str
    status: str
    content_type: str
    attempts: int
    created_at: float
    updated_at: float
    completed_at: float | None
    error_code: str | None
    result_status_code: int | None
    result_media_type: str | None


class JobStore:
    def __init__(self, root: Path, *, now: Callable[[], float] = time.time) -> None:
        self.root = Path(root)
        self.payloads = self.root / "payloads"
        self.results = self.root / "results"
        self.database = self.root / "jobs.sqlite3"
        self.now = now
        self._prepare_paths()
        self._initialize_database()

    def _prepare_paths(self) -> None:
        previous_umask = os.umask(0o077)
        try:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.payloads.mkdir(mode=0o700, exist_ok=True)
            self.results.mkdir(mode=0o700, exist_ok=True)
        finally:
            os.umask(previous_umask)
        for path in (self.root, self.payloads, self.results):
            path.chmod(0o700)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize_database(self) -> None:
        previous_umask = os.umask(0o077)
        try:
            with self._connection() as connection:
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS jobs (
                        id TEXT PRIMARY KEY,
                        idempotency_key TEXT NOT NULL UNIQUE,
                        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
                        content_type TEXT NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL,
                        completed_at REAL,
                        error_code TEXT,
                        result_status_code INTEGER,
                        result_media_type TEXT
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at)"
                )
        finally:
            os.umask(previous_umask)
        self.database.chmod(0o600)

    @staticmethod
    def _validate_job_id(job_id: str) -> None:
        if not _JOB_ID.fullmatch(job_id):
            raise ValueError("Invalid job ID")

    def _payload_path(self, job_id: str) -> Path:
        self._validate_job_id(job_id)
        return self.payloads / f"{job_id}.request"

    def _result_path(self, job_id: str) -> Path:
        self._validate_job_id(job_id)
        return self.results / f"{job_id}.result"

    @staticmethod
    def _record(row: sqlite3.Row | None) -> JobRecord | None:
        if row is None:
            return None
        return JobRecord(**dict(row))

    def _write_new(self, path: Path, content: bytes) -> None:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    def _replace(self, path: Path, content: bytes) -> None:
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        self._write_new(temporary, content)
        try:
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def get(self, job_id: str) -> JobRecord | None:
        if not _JOB_ID.fullmatch(job_id):
            return None
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._record(row)

    def get_by_idempotency_key(self, key: str) -> JobRecord | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM jobs WHERE idempotency_key = ?", (key,)
            ).fetchone()
        return self._record(row)

    def submit(
        self,
        *,
        idempotency_key: str,
        payload: bytes,
        content_type: str,
    ) -> tuple[JobRecord, bool]:
        if not _IDEMPOTENCY_KEY.fullmatch(idempotency_key):
            raise ValueError("Idempotency key must be a lowercase SHA-256 digest")
        if not content_type.strip():
            raise ValueError("Content type is required")
        existing = self.get_by_idempotency_key(idempotency_key)
        if existing is not None:
            return existing, False

        job_id = uuid.uuid4().hex
        payload_path = self._payload_path(job_id)
        self._write_new(payload_path, payload)
        timestamp = self.now()
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO jobs (
                        id, idempotency_key, status, content_type, attempts,
                        created_at, updated_at
                    ) VALUES (?, ?, 'queued', ?, 0, ?, ?)
                    """,
                    (job_id, idempotency_key, content_type, timestamp, timestamp),
                )
        except sqlite3.IntegrityError:
            payload_path.unlink(missing_ok=True)
            existing = self.get_by_idempotency_key(idempotency_key)
            if existing is None:
                raise
            return existing, False
        record = self.get(job_id)
        if record is None:
            raise RuntimeError("Submitted job was not persisted")
        return record, True

    def claim_next(self) -> JobRecord | None:
        timestamp = self.now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1"
            ).fetchone()
            if row is None:
                connection.commit()
                return None
            job_id = row["id"]
            connection.execute(
                """
                UPDATE jobs
                SET status = 'running', attempts = attempts + 1,
                    updated_at = ?, error_code = NULL
                WHERE id = ? AND status = 'queued'
                """,
                (timestamp, job_id),
            )
            claimed = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            connection.commit()
        return self._record(claimed)

    def succeed(
        self,
        job_id: str,
        *,
        result: bytes,
        status_code: int,
        media_type: str | None,
    ) -> None:
        record = self.get(job_id)
        if record is None or record.status != "running":
            raise ValueError("Only running jobs can succeed")
        self._replace(self._result_path(job_id), result)
        timestamp = self.now()
        with self._connection() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET status = 'succeeded', updated_at = ?, completed_at = ?,
                    error_code = NULL, result_status_code = ?, result_media_type = ?
                WHERE id = ? AND status = 'running'
                """,
                (timestamp, timestamp, status_code, media_type, job_id),
            )

    def fail(self, job_id: str, *, error_code: str) -> None:
        if not error_code or len(error_code) > 80:
            raise ValueError("Invalid error code")
        timestamp = self.now()
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs
                SET status = 'failed', updated_at = ?, completed_at = ?, error_code = ?
                WHERE id = ? AND status = 'running'
                """,
                (timestamp, timestamp, error_code, job_id),
            )
        if cursor.rowcount != 1:
            raise ValueError("Only running jobs can fail")

    def reconcile_interrupted(self) -> int:
        timestamp = self.now()
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs
                SET status = 'queued', updated_at = ?, error_code = 'supervisor_restarted'
                WHERE status = 'running'
                """,
                (timestamp,),
            )
        return cursor.rowcount

    def read_payload(self, job_id: str) -> bytes:
        record = self.get(job_id)
        if record is None:
            raise FileNotFoundError("Unknown job")
        return self._payload_path(job_id).read_bytes()

    def read_result(self, job_id: str) -> bytes:
        record = self.get(job_id)
        if record is None or record.status != "succeeded":
            raise FileNotFoundError("Job result is unavailable")
        return self._result_path(job_id).read_bytes()

    def delete(self, job_id: str) -> str:
        record = self.get(job_id)
        if record is None:
            return "not_found"
        if record.status not in _TERMINAL_STATUSES:
            return "active"
        with self._connection() as connection:
            connection.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        self._payload_path(job_id).unlink(missing_ok=True)
        self._result_path(job_id).unlink(missing_ok=True)
        return "deleted"

    def cleanup_expired(self, *, ttl_seconds: float) -> int:
        if ttl_seconds <= 0:
            raise ValueError("TTL must be positive")
        cutoff = self.now() - ttl_seconds
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT id FROM jobs
                WHERE status IN ('succeeded', 'failed') AND completed_at <= ?
                ORDER BY completed_at, id
                """,
                (cutoff,),
            ).fetchall()
        removed = 0
        for row in rows:
            if self.delete(row["id"]) == "deleted":
                removed += 1
        return removed
