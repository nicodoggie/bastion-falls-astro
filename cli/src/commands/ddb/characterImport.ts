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
