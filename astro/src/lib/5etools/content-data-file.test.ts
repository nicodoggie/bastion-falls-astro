import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readContentDataFile } from "./content-data-file.ts";
import { loadCreatureFromContentJson } from "./creature-data.ts";
import { loadItemFromContentJson } from "./item-data.ts";
import { getContentDocsDir } from "./paths.ts";
import { loadSpellFromContentJson } from "./spell-data.ts";

test("reads JSON and YAML content data files as plain objects", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-content-data-"));
  const jsonPath = path.join(dir, "lantern-drake.creature.json");
  const yamlPath = path.join(dir, "lantern-drake.creature.yaml");
  const ymlPath = path.join(dir, "lantern-drake.creature.yml");

  fs.writeFileSync(jsonPath, '{"name":"Lantern Drake","cr":"1"}');
  fs.writeFileSync(
    yamlPath,
    ["name: Lantern Drake", "cr: '1'", "size:", "  - S", ""].join("\n"),
  );
  fs.writeFileSync(
    ymlPath,
    ["name: Lantern Drake", "cr: '1'", "size:", "  - S", ""].join("\n"),
  );

  assert.deepEqual(readContentDataFile(jsonPath), {
    name: "Lantern Drake",
    cr: "1",
  });
  assert.deepEqual(readContentDataFile(yamlPath), {
    name: "Lantern Drake",
    cr: "1",
    size: ["S"],
  });
  assert.deepEqual(readContentDataFile(ymlPath), {
    name: "Lantern Drake",
    cr: "1",
    size: ["S"],
  });
});

test("loads YAML files through 5etools content loaders", () => {
  const tempDir = fs.mkdtempSync(
    path.join(getContentDocsDir(), "world/misc/.tmp-yaml-loader-"),
  );
  const relativeToContentDocs = (fileName: string) =>
    path
      .relative(getContentDocsDir(), path.join(tempDir, fileName))
      .split(path.sep)
      .join("/");

  try {
    fs.writeFileSync(
      path.join(tempDir, "lantern-drake.creature.yaml"),
      [
        "name: Lantern Drake",
        "size: [S]",
        "type: dragon",
        "alignment: [N]",
        "ac: [14]",
        "hp:",
        "  average: 22",
        "  formula: 4d6 + 8",
        "speed:",
        "  walk: 30",
        "str: 12",
        "dex: 16",
        "con: 14",
        "int: 6",
        "wis: 12",
        "cha: 10",
        "passive: 11",
        "cr: '1'",
        "trait:",
        "  - name: Glowing Hide",
        "    entries:",
        "      - The drake sheds {@i dim light} in a 10-foot radius.",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(tempDir, "spark-thread.spell.yaml"),
      [
        "name: Spark Thread",
        "level: 0",
        "school: V",
        "time:",
        "  - number: 1",
        "    unit: action",
        "range:",
        "  type: point",
        "  distance:",
        "    type: feet",
        "    amount: 30",
        "components:",
        "  v: true",
        "duration:",
        "  - type: instant",
        "entries:",
        "  - A thread of fire leaps from your hand.",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(tempDir, "lantern-of-small-suns.item.yaml"),
      [
        "name: Lantern of Small Suns",
        "type: Wondrous item",
        "rarity: rare",
        "reqAttune: true",
        "entries:",
        "  - This lantern sheds {@i impossible} light.",
        "",
      ].join("\n"),
    );

    assert.equal(
      loadCreatureFromContentJson(
        relativeToContentDocs("lantern-drake.creature.yaml"),
      )?.record.name,
      "Lantern Drake",
    );
    assert.equal(
      loadSpellFromContentJson(relativeToContentDocs("spark-thread.spell.yaml"))
        ?.record.name,
      "Spark Thread",
    );
    assert.equal(
      loadItemFromContentJson(
        relativeToContentDocs("lantern-of-small-suns.item.yaml"),
      )?.record.name,
      "Lantern of Small Suns",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
