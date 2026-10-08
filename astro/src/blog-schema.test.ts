import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "astro/zod";

import { blogSchema } from "./blog-schema.ts";

const schema = blogSchema(() => z.string());

test("blog schema accepts published posts without draft and keeps published required", () => {
  const published = {
    title: "A published post",
    published: new Date("2026-01-01"),
  };
  const omittedDraft = schema.safeParse(published);

  assert.equal(omittedDraft.success, true);
  assert.equal(schema.safeParse({ title: published.title }).success, false);
  assert.equal(
    schema.safeParse({ title: published.title, draft: true }).success,
    true,
  );
  assert.equal(schema.safeParse({ ...published, draft: false }).success, true);
});
