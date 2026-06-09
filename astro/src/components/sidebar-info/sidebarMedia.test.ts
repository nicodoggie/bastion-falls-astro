import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSidebarImages,
  resolveSidebarImageUrl,
} from "./sidebarMedia.ts";

describe("sidebar media helpers", () => {
  it("normalizes undefined, single images, and arrays", () => {
    assert.deepEqual(normalizeSidebarImages(undefined), []);
    assert.deepEqual(normalizeSidebarImages({ alt: "Map", url: "./map.png" }), [
      { alt: "Map", url: "./map.png" },
    ]);
    assert.deepEqual(
      normalizeSidebarImages([
        { alt: "Map", url: "./map.png" },
        { alt: "Portrait", url: "/src/assets/portrait.png" },
      ]),
      [
        { alt: "Map", url: "./map.png" },
        { alt: "Portrait", url: "/src/assets/portrait.png" },
      ],
    );
  });

  it("resolves relative image urls against the entry file path", () => {
    assert.equal(
      resolveSidebarImageUrl(
        "./map-of-betera.png",
        "src/content/docs/world/locations/betera/index.mdx",
      ),
      "/src/content/docs/world/locations/betera/map-of-betera.png",
    );
    assert.equal(
      resolveSidebarImageUrl(
        "/src/assets/characters/narmaya.jpg",
        "src/content/docs/world/characters/narmaya.mdx",
      ),
      "/src/assets/characters/narmaya.jpg",
    );
  });
});
