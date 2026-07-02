import assert from "node:assert/strict";
import { test } from "node:test";

import { formatArchiveSummary, isExistingOutputSkip } from "./bulk.js";

test("skips existing outputs only in all mode without force", () => {
  assert.equal(
    isExistingOutputSkip({ all: true, force: false, destinationExists: true }),
    true,
  );
  assert.equal(
    isExistingOutputSkip({ all: true, destinationExists: true }),
    true,
  );
  assert.equal(
    isExistingOutputSkip({ all: true, force: true, destinationExists: true }),
    false,
  );
  assert.equal(
    isExistingOutputSkip({ all: false, force: false, destinationExists: true }),
    false,
  );
  assert.equal(
    isExistingOutputSkip({ all: true, force: false, destinationExists: false }),
    false,
  );
});

test("formats archive all summary with successes, skips, and failures", () => {
  assert.equal(
    formatArchiveSummary([
      {
        status: "archived",
        session: "session-a",
        destination: "/out/session-a.zip",
      },
      {
        status: "skipped",
        session: "session-b",
        destination: "/out/session-b.zip",
      },
      {
        status: "failed",
        session: "session-c",
        error: "Missing required file",
      },
    ]),
    [
      "Archive summary:",
      "  Total: 3",
      "  Archived: 1",
      "  Skipped existing: 1",
      "  Failed: 1",
      "",
      "Failures:",
      "  - session-c: Missing required file",
    ].join("\n"),
  );
});
