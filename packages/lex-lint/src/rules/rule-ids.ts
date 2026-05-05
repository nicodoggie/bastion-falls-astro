/** Kebab-case rule IDs matching `lex-lint.config.json` → `rules`. */
export const RULE_DUPLICATE_JSONLD_ID = "duplicate-jsonld-id" as const;

export type BuiltinRuleId = typeof RULE_DUPLICATE_JSONLD_ID;
