import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGenericSidebarRows,
  getGenericSidebarSubject,
} from "./genericSidebarInfo.ts";

describe("generic sidebar info helpers", () => {
  it("selects supported fallback subjects from page data", () => {
    assert.deepEqual(
      getGenericSidebarSubject({
        event: { type: "war", locations: ["Port Rainoso"] },
        title: "Siege of Somewhere",
      }),
      {
        data: { locations: ["Port Rainoso"], type: "war" },
        key: "event",
        title: "Siege of Somewhere",
      },
    );

    assert.equal(
      getGenericSidebarSubject({
        character: { name: "Narmaya" },
        title: "Narmaya",
      }),
      null,
    );
  });

  it("builds inline and stacked rows for simple fallback data", () => {
    assert.deepEqual(
      buildGenericSidebarRows({
        biomes: ["forest", "urban"],
        image: { url: "/src/assets/species/human.png" },
        locations: ["Tidemark", "Port Rainoso"],
        origin: "Unknown",
        type: "humanoid",
      }),
      [
        { kind: "text", label: "Origin", layout: "inline", text: "Unknown" },
        { kind: "text", label: "Type", layout: "inline", text: "humanoid" },
        {
          items: ["forest", "urban"],
          kind: "list",
          label: "Biomes",
          layout: "stacked",
        },
        {
          items: ["Tidemark", "Port Rainoso"],
          kind: "list",
          label: "Locations",
          layout: "stacked",
        },
      ],
    );
  });
});
