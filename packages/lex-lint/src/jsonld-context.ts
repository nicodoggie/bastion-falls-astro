/** Namespace for lex-lint-defined extension properties (object IRIs). */
export const LEX_LINT_VOCAB = "https://w3id.org/lex-lint/vocab#" as const;

/** Namespace aligned with `etymon:` prefix for etymology literals. */
export const LEX_LINT_ETYM = "https://w3id.org/lex-lint/etymology#" as const;

const ONTOLEX = "http://www.w3.org/ns/lemon/ontolex#" as const;

/**
 * Canonical JSON-LD context for lexicon `graphEntry` fragments (OntoLex / SKOS).
 */
export function createLexiconJsonLdContext(): Record<string, unknown> {
  return {
    ontolex: ONTOLEX,
    lexinfo: "http://www.lexinfo.net/ontology/2.0/lexinfo#",
    skos: "http://www.w3.org/2004/02/skos/core#",
    etymon: `${LEX_LINT_ETYM}`,

    canonicalForm: `${ONTOLEX}canonicalForm`,
    sense: {
      "@id": `${ONTOLEX}sense`,
      "@container": "@set",
    },
    definition: "skos:definition",
    writtenRep: `${ONTOLEX}writtenRep`,
    phoneticRep: `${ONTOLEX}phoneticRep`,
    etymology: `${LEX_LINT_VOCAB}etymology`,
  };
}
