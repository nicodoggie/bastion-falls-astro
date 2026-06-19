import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import satteriRewriteLinks from "./satteri-rewrite-links.ts";

function createContext(sourceFile: string | URL) {
  const updates = new Map<string, unknown>();
  return {
    updates,
    ctx: {
      filename: typeof sourceFile === "string" ? sourceFile : undefined,
      fileURL: sourceFile instanceof URL ? sourceFile : undefined,
      setProperty(_node: unknown, key: string, value: unknown) {
        updates.set(key, value);
      },
    },
  };
}

test("rewrites link nodes relative to the current filename", () => {
  const plugin = satteriRewriteLinks();
  const link = { type: "link", url: "../world/timeline/index.mdx" } as const;
  const { ctx, updates } = createContext(
    "/site/src/content/docs/help/learning/early-hick/index.mdx",
  );

  plugin.link(link, ctx);

  assert.equal(updates.get("url"), "/help/learning/world/timeline/");
});

test("rewrites markdown links inside markmap code fences from file URLs", () => {
  const plugin = satteriRewriteLinks({
    mappings: [{ from: "world/languages", to: "/languages" }],
  });
  const code = {
    type: "code",
    lang: "markmap",
    value:
      "- [Early Hick](../../../world/languages/hickic/seneran/early-hick/index.mdx)",
  } as const;
  const { ctx, updates } = createContext(
    pathToFileURL("/site/src/content/docs/help/learning/early-hick/index.mdx"),
  );

  plugin.code(code, ctx);

  assert.equal(
    updates.get("value"),
    "- [Early Hick](/languages/hickic/seneran/early-hick/)",
  );
});
