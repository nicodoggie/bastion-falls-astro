/** Duplicate `@id` among `@graph` nodes or wrapper `graphEntry` maps. */
export const RULE_JSONLD_DUPLICATE_GRAPH_ID =
  "jsonld/duplicate-graph-id" as const;

/** Opinionated JSON-LD root object key order (human editors). */
export const RULE_JSONLD_ROOT_KEY_ORDER = "jsonld/root-key-order" as const;

export type BuiltinRuleId =
  | typeof RULE_JSONLD_DUPLICATE_GRAPH_ID
  | typeof RULE_JSONLD_ROOT_KEY_ORDER;
