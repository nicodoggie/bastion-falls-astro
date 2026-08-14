import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCharacterApiUrl,
  buildDefaultCampaignJsonPath,
  buildDefaultCharacterJsonPath,
  createDdbCampaignJsonArtifact,
  createRenderedCharacterFallback,
  extractDdbCampaignRoster,
  extractDdbCharacterPayload,
  parseDdbCampaignId,
  parseRenderedCharacterText,
  parseDdbCharacterId,
  serializeDdbCampaignJson,
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

test("parses DDB campaign URLs and numeric campaign IDs", () => {
  assert.equal(parseDdbCampaignId("2396433"), "2396433");
  assert.equal(parseDdbCampaignId("https://www.dndbeyond.com/campaigns/2396433"), "2396433");
});

test("rejects non-campaign URLs", () => {
  assert.throws(() => parseDdbCampaignId("https://www.dndbeyond.com/characters/124205957"), /D&D Beyond campaign URL/);
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

test("builds the default campaign JSON output path", () => {
  assert.equal(
    buildDefaultCampaignJsonPath("/campaign/world/characters", "2396433"),
    "/campaign/world/characters/ddb-campaign-2396433.json",
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

test("extracts campaign roster IDs with visible name hints", () => {
  const roster = extractDdbCampaignRoster({
    campaignId: "9999999",
    url: "https://www.dndbeyond.com/campaigns/9999999",
    title: "Example Campaign - Campaigns - D&D Beyond",
    text: [
      "Active Characters",
      "Example Hero",
      "Lvl 8 | Aasimar | Bard / College of Glamour",
      "Player: example-player",
      "VIEW",
      "EDIT",
      "UNASSIGNED CHARACTERS",
      "Unassigned Example",
      "Lvl 5 | Human | Barbarian / Path of the Wild Heart",
      "Unassigned",
      "VIEW",
      "EDIT",
    ].join("\n"),
    links: [
      { text: "", href: "https://www.dndbeyond.com/profile/example-player/characters/111111111" },
      { text: "VIEW", href: "https://www.dndbeyond.com/profile/example-player/characters/111111111" },
      { text: "REMOVE", href: "https://www.dndbeyond.com/campaigns/9999999/remove-character/111111111" },
      { text: "", href: "https://www.dndbeyond.com/profile/example-dm/characters/222222222" },
      { text: "VIEW", href: "https://www.dndbeyond.com/profile/example-dm/characters/222222222" },
      { text: "CLAIM", href: "https://www.dndbeyond.com/campaigns/222222222/9999999123/claim-unassigned-character" },
    ],
  });

  assert.deepEqual(roster.characters, [
    {
      id: "111111111",
      nameHint: "Example Hero",
      url: "https://www.dndbeyond.com/characters/111111111",
      sourceUrls: [
        "https://www.dndbeyond.com/profile/example-player/characters/111111111",
        "https://www.dndbeyond.com/campaigns/9999999/remove-character/111111111",
      ],
    },
    {
      id: "222222222",
      nameHint: "Unassigned Example",
      url: "https://www.dndbeyond.com/characters/222222222",
      sourceUrls: [
        "https://www.dndbeyond.com/profile/example-dm/characters/222222222",
        "https://www.dndbeyond.com/campaigns/222222222/9999999123/claim-unassigned-character",
      ],
    },
  ]);
});

test("serializes DDB campaign JSON with import metadata", () => {
  const campaign = createDdbCampaignJsonArtifact({
    id: "9999999",
    url: "https://www.dndbeyond.com/campaigns/9999999",
    title: "Example Campaign - Campaigns - D&D Beyond",
    characters: [
      {
        id: "111111111",
        nameHint: "Example Hero",
        url: "https://www.dndbeyond.com/characters/111111111",
        sourceUrls: ["https://www.dndbeyond.com/profile/example-player/characters/111111111"],
      },
    ],
  }, {
    campaignId: "9999999",
    sourceUrl: "https://www.dndbeyond.com/campaigns/9999999",
    fetchedAt: "2026-06-08T00:00:00.000Z",
  });

  assert.deepEqual(campaign.importedFrom, {
    source: "dndbeyond",
    campaignId: "9999999",
    sourceUrl: "https://www.dndbeyond.com/campaigns/9999999",
    fetchedAt: "2026-06-08T00:00:00.000Z",
  });

  const json = serializeDdbCampaignJson(campaign.campaign, campaign.importedFrom);
  assert.deepEqual(JSON.parse(json), campaign);
  assert.equal(json.endsWith("\n"), true);
});

test("parses mechanics from rendered DDB character sheet text", () => {
  const rendered = parseRenderedCharacterText({
    characterId: "84373628",
    url: "https://www.dndbeyond.com/characters/84373628",
    title: "Guillerma's Character Sheet - D&D Beyond",
    text: [
      "SIGN OUT",
      "Guillerma",
      "MANAGE",
      "FemaleVariant HumanMonk 6 / Rogue 3",
      "Level 9",
      "Ability Scores",
      "STR",
      "+",
      "0",
      "10",
      "DEX",
      "+",
      "3",
      "16",
      "CON",
      "+",
      "2",
      "14",
      "INT",
      "-",
      "1",
      "8",
      "WIS",
      "+",
      "2",
      "15",
      "CHA",
      "+",
      "3",
      "16",
      "Speed",
      "WALKING",
      "30",
      "ft.",
      "HIT POINTS",
      "Max hit points",
      "72",
      "Senses",
      "12",
      "PASSIVE PERCEPTION",
      "13",
      "PASSIVE INVESTIGATION",
      "16",
      "PASSIVE INSIGHT",
      "ARMOR CLASS",
      "ARMOR",
      "16",
      "CLASS",
      "LANGUAGES",
      "Apgarian, Thieves' cant, Common, Elvish, Thieves’ Cant",
    ].join("\n"),
  });

  assert.deepEqual(rendered.mechanics, {
    name: "Guillerma",
    summaryLine: "FemaleVariant HumanMonk 6 / Rogue 3",
    level: 9,
    armorClass: 16,
    maxHitPoints: 72,
    speed: { walking: 30 },
    senses: {
      passivePerception: 12,
      passiveInvestigation: 13,
      passiveInsight: 16,
    },
    languages: ["Apgarian", "Thieves' cant", "Common", "Elvish", "Thieves’ Cant"],
    stats: {
      strength: 10,
      dexterity: 16,
      constitution: 14,
      intelligence: 8,
      wisdom: 15,
      charisma: 16,
    },
  });
});

test("creates a rendered fallback artifact inside the character payload", () => {
  const fallback = createRenderedCharacterFallback({
    characterId: "84373628",
    sourceUrl: "https://www.dndbeyond.com/characters/84373628",
    fetchedAt: "2026-06-07T00:00:00.000Z",
    reason: "DDB character API returned 403",
    rendered: {
      url: "https://www.dndbeyond.com/characters/84373628",
      title: "Guillerma's Character Sheet - D&D Beyond",
      text: "Guillerma\nMANAGE\nLevel 9",
      mechanics: { name: "Guillerma", level: 9 },
      tabs: {
        background: { clicked: true, text: "BACKGROUND\nEntertainer" },
        notes: { clicked: true, text: "ORGANIZATIONS\nHunting Lodge" },
      },
    },
  });

  assert.deepEqual(JSON.parse(fallback), {
    importedFrom: {
      source: "dndbeyond",
      characterId: "84373628",
      sourceUrl: "https://www.dndbeyond.com/characters/84373628",
      fetchedAt: "2026-06-07T00:00:00.000Z",
    },
    character: {
      id: "84373628",
      importMode: "rendered-sheet-fallback",
      fallbackReason: "DDB character API returned 403",
      renderedSheet: {
        url: "https://www.dndbeyond.com/characters/84373628",
        title: "Guillerma's Character Sheet - D&D Beyond",
        text: "Guillerma\nMANAGE\nLevel 9",
        mechanics: { name: "Guillerma", level: 9 },
        tabs: {
          background: { clicked: true, text: "BACKGROUND\nEntertainer" },
          notes: { clicked: true, text: "ORGANIZATIONS\nHunting Lodge" },
        },
      },
    },
  });
});
