import type { LexiconFileShape } from "./types.js";

export function isLexiconWrapper(
  doc: unknown,
): doc is LexiconFileShape & { lexicon: Record<string, unknown> } {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return false;
  }
  const o = doc as Record<string, unknown>;
  const lex = o.lexicon;
  return (
    lex !== null &&
    typeof lex === "object" &&
    !Array.isArray(lex)
  );
}

/** Full JSON-LD lexicon document (`@context` + `@graph`, often `.jsonld`). */
export function isJsonLdGraphLexicon(doc: unknown): doc is Record<string, unknown> {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return false;
  }
  const o = doc as Record<string, unknown>;
  if (!("@graph" in o) || !("@context" in o)) {
    return false;
  }
  return Array.isArray(o["@graph"]);
}
