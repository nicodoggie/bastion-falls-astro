export type LintSeverity = "error" | "warning";

export type LintOptions = {
  /** Base IRI for relative `@id` in `graphEntry`. */
  baseIri?: string;
  /**
   * When false, only `@base` is merged (no lex-lint vocabulary). Used to prove
   * that raw fragments do not expand into OntoLex triples without the merge.
   */
  mergeContext?: boolean;
  shacl?: boolean;
  /** Turtle / TriG shapes file; defaults to bundled `shapes/lexicon-core.ttl`. */
  shaclShapesPath?: string;
  file?: string;
  /**
   * When set (with `mergeContext` not false), used as `@context` instead of the
   * built-in lex-lint OntoLex context — for standalone `.jsonld` assets that ship
   * their own vocabulary map.
   */
  jsonLdDocumentContext?: unknown;
  /**
   * Per-rule overrides from `lex-lint.config.json` `rules` map; keys are rule
   * ids (kebab-case).
   */
  ruleSettings?: Partial<Record<string, "off" | "warn" | "error">>;
};

export type LintDiagnostic = {
  severity: LintSeverity;
  code: string;
  message: string;
  /** When set, `applyRuleSeverities` respects config `rules.<ruleId>`. */
  ruleId?: string;
  file?: string;
  entryKey?: string;
  /** 1-based line in `file` (VS Code–style terminal links when paired with column). */
  line?: number;
  /** 1-based column in `file`. */
  column?: number;
};

export type LintReport = {
  ok: boolean;
  diagnostics: LintDiagnostic[];
};

export type LexiconFileShape = {
  id?: unknown;
  title?: unknown;
  lexicon?: unknown;
};
