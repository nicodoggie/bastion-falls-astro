import { resolve } from "node:path";

export type DdbImportMetadata = {
  characterId: string;
  sourceUrl: string;
  fetchedAt: string;
};

export type DdbCharacterJsonArtifact = {
  importedFrom: {
    source: "dndbeyond";
    characterId: string;
    sourceUrl: string;
    fetchedAt: string;
  };
  character: unknown;
};

export type RenderedCharacterTab = {
  clicked: boolean;
  text: string;
};

export type RenderedCharacterData = {
  url: string;
  title: string;
  text: string;
  mechanics: Record<string, unknown>;
  tabs?: Record<string, RenderedCharacterTab>;
};

export type RenderedCharacterFallbackOptions = DdbImportMetadata & {
  reason: string;
  rendered: RenderedCharacterData;
};

export function parseDdbCharacterId(urlOrId: string): string {
  if (/^\d+$/.test(urlOrId)) return urlOrId;

  let url: URL;
  try {
    url = new URL(urlOrId);
  } catch {
    throw new Error("Expected a D&D Beyond character URL or numeric character ID");
  }

  const match = url.pathname.match(/\/characters\/(\d+)/);
  if (!match || !(url.hostname === "www.dndbeyond.com" || url.hostname === "dndbeyond.com" || url.hostname === "ddb.ac")) {
    throw new Error("Expected a D&D Beyond character URL like https://www.dndbeyond.com/characters/123");
  }

  return match[1];
}

export function buildCharacterApiUrl(characterId: string): string {
  return `https://character-service.dndbeyond.com/character/v5/character/${characterId}`;
}

export function buildDefaultCharacterJsonPath(targetDir: string, characterId: string): string {
  return resolve(targetDir, `ddb-character-${characterId}.json`);
}

export function extractDdbCharacterPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new Error("DDB response was not an object");
  }

  const maybeWrapped = payload as { success?: boolean; data?: unknown; message?: string };
  if ("success" in maybeWrapped && maybeWrapped.success === false) {
    throw new Error(`DDB character request failed${maybeWrapped.message ? `: ${maybeWrapped.message}` : ""}`);
  }

  const data = "data" in maybeWrapped ? maybeWrapped.data : payload;
  if (!data || typeof data !== "object") {
    throw new Error("DDB response did not contain character data");
  }

  return data;
}

export function createDdbCharacterJsonArtifact(character: unknown, metadata: DdbImportMetadata): DdbCharacterJsonArtifact {
  return {
    importedFrom: {
      source: "dndbeyond",
      characterId: metadata.characterId,
      sourceUrl: metadata.sourceUrl,
      fetchedAt: metadata.fetchedAt,
    },
    character,
  };
}

export function serializeDdbCharacterJson(character: unknown, metadata: DdbImportMetadata): string {
  return `${JSON.stringify(createDdbCharacterJsonArtifact(character, metadata), null, 2)}\n`;
}

export function parseRenderedCharacterText(input: {
  characterId: string;
  url: string;
  title: string;
  text: string;
}): RenderedCharacterData {
  const lines = toLines(input.text);
  return {
    url: input.url,
    title: input.title,
    text: input.text,
    mechanics: {
      name: parseName(lines, input.title),
      summaryLine: parseSummaryLine(lines),
      level: parseLevel(lines),
      armorClass: parseNumberAfterLine(lines, "ARMOR", (index) => lines[index + 2] === "CLASS"),
      maxHitPoints: parseNumberAfterLine(lines, "Max hit points"),
      speed: {
        walking: parseNumberAfterLine(lines, "WALKING", (index) => lines[index + 2] === "ft."),
      },
      senses: {
        passivePerception: parseNumberBeforeLine(lines, "PASSIVE PERCEPTION"),
        passiveInvestigation: parseNumberBeforeLine(lines, "PASSIVE INVESTIGATION"),
        passiveInsight: parseNumberBeforeLine(lines, "PASSIVE INSIGHT"),
      },
      languages: parseLanguages(lines),
      stats: parseAbilityScores(lines),
    },
  };
}

export function createRenderedCharacterFallback(options: RenderedCharacterFallbackOptions): string {
  return serializeDdbCharacterJson({
    id: options.characterId,
    importMode: "rendered-sheet-fallback",
    fallbackReason: options.reason,
    renderedSheet: options.rendered,
  }, {
    characterId: options.characterId,
    sourceUrl: options.sourceUrl,
    fetchedAt: options.fetchedAt,
  });
}

function toLines(text: string): string[] {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseName(lines: string[], title: string): string | undefined {
  for (const [index, line] of lines.entries()) {
    if (line !== "MANAGE") continue;
    const previous = lines[index - 1];
    const next = lines[index + 1];
    if (previous && next && /Level \d+/.test(lines[index + 2] ?? "")) return previous;
  }

  const titleMatch = title.match(/^(.+?)'s Character Sheet/);
  return titleMatch?.[1];
}

function parseSummaryLine(lines: string[]): string | undefined {
  const manageIndex = lines.findIndex((line, index) => line === "MANAGE" && /Level \d+/.test(lines[index + 2] ?? ""));
  return manageIndex >= 0 ? lines[manageIndex + 1] : undefined;
}

function parseLevel(lines: string[]): number | undefined {
  const line = lines.find((entry) => /^Level \d+$/.test(entry));
  const match = line?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function parseNumberAfterLine(lines: string[], label: string, predicate?: (index: number) => boolean): number | undefined {
  for (const [index, line] of lines.entries()) {
    if (line !== label) continue;
    if (predicate && !predicate(index)) continue;
    const value = lines.slice(index + 1, index + 6).find(isInteger);
    return value === undefined ? undefined : Number(value);
  }
}

function parseNumberBeforeLine(lines: string[], label: string): number | undefined {
  const index = lines.indexOf(label);
  if (index <= 0) return undefined;
  const value = lines[index - 1];
  return value && isInteger(value) ? Number(value) : undefined;
}

function parseLanguages(lines: string[]): string[] | undefined {
  const index = lines.indexOf("LANGUAGES");
  const value = index >= 0 ? lines[index + 1] : undefined;
  if (!value) return undefined;
  return value.split(",").map((language) => language.trim()).filter(Boolean);
}

function parseAbilityScores(lines: string[]): Record<string, number | undefined> {
  return {
    strength: parseAbilityScore(lines, "STR"),
    dexterity: parseAbilityScore(lines, "DEX"),
    constitution: parseAbilityScore(lines, "CON"),
    intelligence: parseAbilityScore(lines, "INT"),
    wisdom: parseAbilityScore(lines, "WIS"),
    charisma: parseAbilityScore(lines, "CHA"),
  };
}

function parseAbilityScore(lines: string[], label: string): number | undefined {
  const index = lines.indexOf(label);
  if (index < 0) return undefined;

  const value = lines.slice(index + 1, index + 5).filter(isInteger).at(-1);
  return value === undefined ? undefined : Number(value);
}

function isInteger(value: string): boolean {
  return /^-?\d+$/.test(value);
}
