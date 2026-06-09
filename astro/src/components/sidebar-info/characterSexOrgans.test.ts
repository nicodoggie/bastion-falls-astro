import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCharacterSexOrganSections } from "./characterSexOrgans.ts";

describe("character sex organ formatting", () => {
  it("formats supported organ types into labeled sections and rows", () => {
    const sections = getCharacterSexOrganSections([
      {
        type: "penis",
        length: 7,
        pubicHair: {
          color: "black",
          style: "trimmed",
        },
      },
      {
        type: "vagina",
        profile: ["neat", "soft"],
        elasticity: "supple",
        pubicHair: {
          length: "full",
        },
      },
      {
        type: "breasts",
        size: "large",
        nipples: "normal",
      },
    ]);

    assert.deepEqual(sections, [
      {
        title: "Penis",
        rows: [
          { label: "Length", value: "7" },
          { label: "Pubic hair style", value: "trimmed" },
          { label: "Pubic hair color", value: "black" },
        ],
      },
      {
        title: "Vagina",
        rows: [
          { label: "Profile", value: "neat, soft" },
          { label: "Elasticity", value: "supple" },
          { label: "Pubic hair length", value: "full" },
        ],
      },
      {
        title: "Breasts",
        rows: [
          { label: "Size", value: "large" },
          { label: "Nipples", value: "normal" },
        ],
      },
    ]);
  });

  it("omits empty sections", () => {
    const sections = getCharacterSexOrganSections([
      {
        type: "vagina",
      },
      {
        type: "breasts",
      },
    ]);

    assert.deepEqual(sections, [
      { title: "Vagina", rows: [] },
      { title: "Breasts", rows: [] },
    ]);
  });
});
