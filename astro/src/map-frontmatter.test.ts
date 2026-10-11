import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import matter from "gray-matter";
import { collectionExtensions } from "./collection-schemas.js";

test("production frontmatter parser retains Oranrakran map calibration", () => {
  const source = readFileSync(
    new URL("./content/docs/world/locations/oranrakran.mdx", import.meta.url),
    "utf8",
  );
  const { data } = matter(source);
  const parsed = collectionExtensions.location.schema.parse(data);
  assert.ok(parsed.location?.map?.scale);
  assert.deepEqual(parsed.location.map, data.location.map);
  assert.equal(parsed.location.map.dimensions?.width, 1910);
  assert.equal(parsed.location.map.dimensions?.height, 1670);
  assert.equal(parsed.location.map.scale.status, "provisional");
});
