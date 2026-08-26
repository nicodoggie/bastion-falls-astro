import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildSummaryContextExcerpt, collectContextFiles, extractGlossaryEntries } from "./context.js";

test("extracts glossary entries from frontmatter, headings, filenames, and JSON names", () => {
  const entries = extractGlossaryEntries([
    {
      path: "world/characters/tiphanie.mdx",
      content: "---\ntitle: Tiphanie the Sapphire Witch\ntags:\n  - the-vengeful\n---\n# Lady Vanessa\n## Candle Bearer Test\n",
    },
    {
      path: "world/items/topaz-sword-of-summer.item.json",
      content: JSON.stringify({ name: "Topaz Sword of Summer" }),
    },
  ]);

  assert.deepEqual(
    ["Candle Bearer Test", "Lady Vanessa", "Tiphanie", "Tiphanie the Sapphire Witch", "Topaz Sword of Summer"].every((entry) =>
      entries.includes(entry),
    ),
    true,
  );
});

test("bounds combined summary context while retaining source headings", () => {
  const excerpt = buildSummaryContextExcerpt(Array.from({ length: 40 }, (_, index) => ({ path: `world/${index}.mdx`, content: "x".repeat(4000) })));
  assert.equal(excerpt.length <= 4000, true);
  assert.match(excerpt, /world\/0\.mdx/u);
  assert.doesNotMatch(excerpt, /world\/39\.mdx/u);
});

test("excludes active-session authored context before reading", async () => {
  const root = await mkdtemp(join(tmpdir(), "transcribe-context-exclude-"));
  await mkdir(join(root, "world", "notes", "the-vengeful"), { recursive: true });
  await writeFile(join(root, "world", "notes", "the-vengeful", "2026-08-15.mdx"), "CURRENT SESSION SECRET\n");
  await writeFile(join(root, "world", "notes", "the-vengeful", "2026-08-14.mdx"), "Prior session context\n");
  try {
    const files = await collectContextFiles({ contextRoot: root, campaign: "the-vengeful", outDir: join(root, "out"), excludePathFragments: ["2026-08-15"] });
    assert.deepEqual(files.map((file) => file.path), ["world/notes/the-vengeful/2026-08-14.mdx"]);
    assert.doesNotMatch(files.map((file) => file.content).join("\n"), /CURRENT SESSION SECRET/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
