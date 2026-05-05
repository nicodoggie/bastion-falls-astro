export {
  createLexiconJsonLdContext,
  LEX_LINT_ETYM,
  LEX_LINT_VOCAB,
} from "./jsonld-context.js";
export { defaultBaseIriFromLexicon } from "./base-iri.js";
export {
  lintGraphEntry,
  mergeGraphEntryDocument,
} from "./lint-graph-entry.js";
export { lintLexiconFile } from "./lint-file.js";
export { lintGlobPatterns } from "./run-glob.js";
export type {
  LexiconFileShape,
  LintDiagnostic,
  LintOptions,
  LintReport,
  LintSeverity,
} from "./types.js";
