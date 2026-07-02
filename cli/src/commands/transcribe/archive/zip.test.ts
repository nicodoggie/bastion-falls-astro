import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import AdmZip from "adm-zip";

import { createZipArchive } from "./zip.js";

test("writes a zip whose entries use the provided names and contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-archive-zip-"));
  const audioPath = join(dir, "tmp-audio.opus");
  const transcriptPath = join(dir, "raw_transcript.md");
  await writeFile(audioPath, "FAKE_OPUS_BYTES", "utf8");
  await writeFile(transcriptPath, "# transcript\n", "utf8");

  const outPath = join(dir, "nested", "session1.zip");
  await createZipArchive(
    [
      { path: audioPath, name: "session-audio.opus" },
      { path: transcriptPath, name: "raw_transcript.md" },
    ],
    outPath,
  );

  // File exists on disk.
  await readFile(outPath);

  const zip = new AdmZip(outPath);
  const names = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .sort();
  assert.deepEqual(names, ["raw_transcript.md", "session-audio.opus"]);
  assert.equal(zip.readAsText("raw_transcript.md"), "# transcript\n");
  assert.equal(zip.readAsText("session-audio.opus"), "FAKE_OPUS_BYTES");
});
