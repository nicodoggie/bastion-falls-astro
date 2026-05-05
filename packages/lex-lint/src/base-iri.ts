/**
 * Default base IRI for a lexicon document. Prefer the top-level `id` string (e.g.
 * `lexicon:EarlyHick_-`) when present so entry IDs remain stable across runs.
 */
export function defaultBaseIriFromLexicon(
  lexiconDoc: { id?: unknown },
  fallbackHint: string,
): string {
  if (typeof lexiconDoc.id === "string" && lexiconDoc.id.length > 0) {
    return `https://w3id.org/lex-lint/lexicon/${encodeURIComponent(lexiconDoc.id)}/`;
  }
  const safe = fallbackHint.replaceAll(/[^\w./-]+/g, "_").slice(-200);
  return `https://w3id.org/lex-lint/lexicon/file/${encodeURIComponent(safe)}/`;
}
