import type { GlossPair, GlossPairInput, GlossTokenType } from "./types.ts";

function splitTokens(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

function normalizeType(type: GlossTokenType | undefined): GlossTokenType {
  return type ?? "word";
}

export function normalizeGlossPairs(tokens: readonly GlossPairInput[]): GlossPair[] {
  return tokens.map((token, index) => ({
    id: `g${String(index + 1)}`,
    source: token.source,
    gloss: token.gloss,
    type: normalizeType(token.type),
  }));
}

export function createGlossPairsFromLines(source: string, gloss: string): GlossPair[] {
  const sourceTokens = splitTokens(source);
  const glossTokens = splitTokens(gloss);
  if (sourceTokens.length !== glossTokens.length) {
    throw new Error(
      "Interlinear gloss source and gloss lines must have the same number of tokens.",
    );
  }
  return normalizeGlossPairs(
    sourceTokens.map((token, index) => ({
      source: token,
      gloss: glossTokens[index] ?? "",
    })),
  );
}
