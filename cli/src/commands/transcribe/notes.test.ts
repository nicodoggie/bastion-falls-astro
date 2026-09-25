import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bindNotesFrontmatter,
  buildNotesFrontmatter,
  getNotesPath,
} from "./notes.js";

test("builds campaign notes path and frontmatter", () => {
  assert.equal(
    getNotesPath({
      contextRoot: "/repo/astro/src/content/docs",
      campaign: "the-vengeful",
      sessionDate: "2026-05-22",
    }),
    "/repo/astro/src/content/docs/world/notes/the-vengeful/2026-05-22.mdx",
  );

  assert.equal(
    buildNotesFrontmatter({
      campaign: "the-vengeful",
      sessionDate: "2026-05-22",
    }),
    "---\ntitle: 'The Vengeful Notes 2026-05-22'\ntags:\n  - notes\n  - the-vengeful\n---\n",
  );
  const identity = { campaign: "the-vengeful", sessionDate: "2026-05-22" };
  for (const body of [
    "## Summary\n\n- Event.",
    "---\ntitle: Invented date\ntags: [wrong]\n---\n## Summary\n\n- Event.",
  ]) {
    assert.equal(
      bindNotesFrontmatter(body, identity),
      `${buildNotesFrontmatter(identity)}## Summary\n\n- Event.\n`,
    );
  }
  assert.throws(
    () => bindNotesFrontmatter("---\ntitle: incomplete", identity),
    /frontmatter/,
  );
});
