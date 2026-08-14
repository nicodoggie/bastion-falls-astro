import tempfile
import unittest
from pathlib import Path

from job_store import JobStore


class JobStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name) / "jobs"
        self.now = 1_000.0
        self.store = JobStore(self.root, now=lambda: self.now)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_submission_is_idempotent_and_persists_payload_outside_sqlite(self):
        key = "a" * 64
        first, created = self.store.submit(
            idempotency_key=key,
            payload=b"multipart request bytes",
            content_type="multipart/form-data; boundary=test",
        )
        second, repeated = self.store.submit(
            idempotency_key=key,
            payload=b"different retry boundary",
            content_type="multipart/form-data; boundary=retry",
        )

        self.assertTrue(created)
        self.assertFalse(repeated)
        self.assertEqual(second.id, first.id)
        self.assertEqual(second.status, "queued")
        self.assertEqual(self.store.read_payload(first.id), b"multipart request bytes")
        self.assertNotIn(b"multipart request bytes", (self.root / "jobs.sqlite3").read_bytes())
        self.assertEqual((self.root.stat().st_mode & 0o777), 0o700)
        self.assertEqual((self.root / "payloads" / f"{first.id}.request").stat().st_mode & 0o777, 0o600)

    def test_claim_and_result_survive_a_new_store_instance(self):
        submitted, _ = self.store.submit(
            idempotency_key="b" * 64,
            payload=b"audio request",
            content_type="multipart/form-data; boundary=test",
        )
        claimed = self.store.claim_next()
        self.assertIsNotNone(claimed)
        self.assertEqual(claimed.id, submitted.id)
        self.assertEqual(claimed.status, "running")
        self.assertEqual(claimed.attempts, 1)

        self.store.succeed(
            submitted.id,
            result=b'{"segments":[]}',
            status_code=200,
            media_type="application/json",
        )
        reopened = JobStore(self.root, now=lambda: self.now)
        record = reopened.get(submitted.id)

        self.assertIsNotNone(record)
        self.assertEqual(record.status, "succeeded")
        self.assertEqual(record.result_status_code, 200)
        self.assertEqual(record.result_media_type, "application/json")
        self.assertEqual(reopened.read_result(submitted.id), b'{"segments":[]}')

    def test_startup_reconciliation_requeues_interrupted_running_job(self):
        submitted, _ = self.store.submit(
            idempotency_key="c" * 64,
            payload=b"audio request",
            content_type="multipart/form-data; boundary=test",
        )
        self.store.claim_next()
        self.now += 10

        reconciled = self.store.reconcile_interrupted()
        record = self.store.get(submitted.id)

        self.assertEqual(reconciled, 1)
        self.assertEqual(record.status, "queued")
        self.assertEqual(record.attempts, 1)
        self.assertEqual(record.error_code, "supervisor_restarted")
        self.assertEqual(self.store.claim_next().id, submitted.id)

    def test_cleanup_removes_only_expired_terminal_jobs_and_their_files(self):
        succeeded, _ = self.store.submit(
            idempotency_key="d" * 64,
            payload=b"completed request",
            content_type="multipart/form-data; boundary=test",
        )
        self.store.claim_next()
        self.store.succeed(
            succeeded.id,
            result=b"result",
            status_code=200,
            media_type="application/json",
        )
        self.now += 50
        queued, _ = self.store.submit(
            idempotency_key="e" * 64,
            payload=b"queued request",
            content_type="multipart/form-data; boundary=test",
        )
        self.now += 51

        removed = self.store.cleanup_expired(ttl_seconds=100)

        self.assertEqual(removed, 1)
        self.assertIsNone(self.store.get(succeeded.id))
        self.assertFalse((self.root / "payloads" / f"{succeeded.id}.request").exists())
        self.assertFalse((self.root / "results" / f"{succeeded.id}.result").exists())
        self.assertIsNotNone(self.store.get(queued.id))
        self.assertEqual(self.store.read_payload(queued.id), b"queued request")

    def test_delete_refuses_running_jobs_and_removes_terminal_jobs(self):
        submitted, _ = self.store.submit(
            idempotency_key="f" * 64,
            payload=b"audio request",
            content_type="multipart/form-data; boundary=test",
        )
        self.store.claim_next()

        self.assertEqual(self.store.delete(submitted.id), "active")
        self.store.fail(submitted.id, error_code="worker_failed")
        self.assertEqual(self.store.delete(submitted.id), "deleted")
        self.assertEqual(self.store.delete(submitted.id), "not_found")


if __name__ == "__main__":
    unittest.main()
