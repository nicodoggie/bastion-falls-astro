export type LintSeverity = "error" | "warning";

export type LintDiagnostic = {
  severity: LintSeverity;
  code: string;
  message: string;
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
};

export type LexiconFileShape = {
  id?: unknown;
  title?: unknown;
  lexicon?: unknown;
};
