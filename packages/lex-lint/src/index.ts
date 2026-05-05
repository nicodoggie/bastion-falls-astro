export {
  createLexiconJsonLdContext,
  LEX_LINT_ETYM,
  LEX_LINT_VOCAB,
} from "./jsonld-context.js";
export { defaultBaseIriFromLexicon } from "./base-iri.js";
export {
  CONFIG_FILENAME,
  defaultLexLintConfig,
  findLexLintConfigPath,
  loadLexLintConfigFile,
  mergeConfigWithCli,
  parseLexLintConfigDocument,
} from "./config.js";
export { runFixPipeline } from "./fix-pipeline.js";
export { isJsonLdGraphLexicon, isLexiconWrapper } from "./detect-format.js";
export {
  lintGraphEntry,
  mergeGraphEntryDocument,
} from "./lint-graph-entry.js";
export { lintJsonLdGraphDocument } from "./lint-jsonld-graph.js";
export { lintLexiconFile, lintLexiconParsed } from "./lint-file.js";
export {
  expandLintPatterns,
  lintGlobPatterns,
} from "./run-glob.js";
export { RULE_MODULES } from "./rules/registry.js";
export { effectiveRuleSeverity, applyRuleSeverities } from "./rules/apply-severities.js";
export type {
  LexiconFileShape,
  LintDiagnostic,
  LintOptions,
  LintReport,
  LintSeverity,
} from "./types.js";
