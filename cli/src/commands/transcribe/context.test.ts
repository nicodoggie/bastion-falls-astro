import assert from "node:assert/strict";
import { test } from "node:test";

import { extractGlossaryEntries } from "./context.js";

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
