import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCharacterApiUrl,
  buildDefaultCharacterJsonPath,
  extractDdbCharacterPayload,
  parseDdbCharacterId,
  serializeDdbCharacterJson,
} from "./characterImport.js";

const wrappedPayload = {
  id: 124205957,
  success: true,
  message: null,
  data: {
    id: 124205957,
    name: "Jessica (Minerva)",
    race: { fullName: "Aasimar" },
  },
  pagination: null,
};

test("parses DDB and ddb.ac character URLs", () => {
  assert.equal(parseDdbCharacterId("https://www.dndbeyond.com/characters/124205957"), "124205957");
  assert.equal(parseDdbCharacterId("https://ddb.ac/characters/124205957/abc123"), "124205957");
});

test("rejects non-character URLs", () => {
  assert.throws(() => parseDdbCharacterId("https://www.dndbeyond.com/monsters/1"), /D&D Beyond character URL/);
});

test("builds the DDB character JSON API URL", () => {
  assert.equal(
    buildCharacterApiUrl("124205957"),
    "https://character-service.dndbeyond.com/character/v5/character/124205957",
  );
});

test("builds the default character JSON output path", () => {
  assert.equal(
    buildDefaultCharacterJsonPath("/campaign/world/characters", "124205957"),
    "/campaign/world/characters/ddb-character-124205957.json",
  );
});

test("extracts raw DDB character data from wrapped API response", () => {
  assert.deepEqual(extractDdbCharacterPayload(wrappedPayload), wrappedPayload.data);
});

test("rejects failed DDB API responses", () => {
  assert.throws(
    () => extractDdbCharacterPayload({ success: false, message: "Nope", data: { errorCode: "x" } }),
    /DDB character request failed: Nope/,
  );
});

test("serializes DDB character JSON with import metadata", () => {
  const json = serializeDdbCharacterJson(wrappedPayload.data, {
    characterId: "124205957",
    sourceUrl: "https://ddb.ac/characters/124205957",
    fetchedAt: "2026-06-05T00:00:00.000Z",
  });

  assert.deepEqual(JSON.parse(json), {
    importedFrom: {
      source: "dndbeyond",
      characterId: "124205957",
      sourceUrl: "https://ddb.ac/characters/124205957",
      fetchedAt: "2026-06-05T00:00:00.000Z",
    },
    character: wrappedPayload.data,
  });
  assert.equal(json.endsWith("\n"), true);
});
