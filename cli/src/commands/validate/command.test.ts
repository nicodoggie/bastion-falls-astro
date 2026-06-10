import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { getRequiredFields, makeSchemaStrict } from "./command.js";

test("finds required fields inside Zod 4 object and union schemas", () => {
  const schema = z.object({
    title: z.string(),
    nested: z.object({
      label: z.string(),
      optionalLabel: z.string().optional(),
    }),
    variant: z.union([
      z.object({ kind: z.literal("a"), alpha: z.string() }),
      z.object({ kind: z.literal("b"), beta: z.number() }),
    ]),
    withDefault: z.string().default("fallback"),
  });

  assert.deepEqual(getRequiredFields(schema), [
    "title",
    "nested.label",
    "variant.kind",
    "variant.alpha",
    "variant.kind",
    "variant.beta",
  ]);
});

test("makes nested Zod 4 object schemas strict without breaking wrappers", () => {
  const schema = z.object({
    nested: z.object({
      label: z.string(),
    }),
    items: z.array(z.object({ label: z.string() })),
    maybe: z.object({ label: z.string() }).optional(),
    withDefault: z.object({ label: z.string() }).default({ label: "fallback" }),
    variant: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("a"), alpha: z.string() }),
      z.object({ kind: z.literal("b"), beta: z.number() }),
    ]),
  });

  const strictSchema = makeSchemaStrict(schema);

  assert.doesNotThrow(() =>
    strictSchema.parse({
      nested: { label: "ok" },
      items: [{ label: "ok" }],
      variant: { kind: "a", alpha: "ok" },
    }),
  );
  assert.throws(() =>
    strictSchema.parse({
      nested: { label: "ok", extra: true },
      items: [{ label: "ok" }],
      variant: { kind: "a", alpha: "ok" },
    }),
  );
  assert.throws(() =>
    strictSchema.parse({
      nested: { label: "ok" },
      items: [{ label: "ok", extra: true }],
      variant: { kind: "a", alpha: "ok" },
    }),
  );
  assert.throws(() =>
    strictSchema.parse({
      nested: { label: "ok" },
      items: [{ label: "ok" }],
      variant: { kind: "a", alpha: "ok", extra: true },
    }),
  );
});
