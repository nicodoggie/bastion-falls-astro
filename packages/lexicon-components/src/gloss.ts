import type { GlossPair, GlossPairInput, GlossTokenType } from "./types";

function splitTokens(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

function normalizeType(type: GlossTokenType | undefined): GlossTokenType {
  return type ?? "word";
}

function normalizeAffixBoundary(value: string, type: GlossTokenType): string {
  if (!value) return value;
  if (type === "prefix") return value.endsWith("-") ? value : `${value}-`;
  if (type === "suffix") return value.startsWith("-") ? value : `-${value}`;
  return value;
}

export function normalizeGlossPairs(tokens: readonly GlossPairInput[]): GlossPair[] {
  return tokens.map((token, index) => {
    const type = normalizeType(token.type);
    return {
      id: `g${String(index + 1)}`,
      source: normalizeAffixBoundary(token.source, type),
      gloss: normalizeAffixBoundary(token.gloss, type),
      type,
    };
  });
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
