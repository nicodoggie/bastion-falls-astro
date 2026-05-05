import type { LintDiagnostic } from "../types.js";
import { duplicateJsonLdIdRule } from "./implementations/duplicate-jsonld-id.js";
import type { LintContext, LintRuleModule } from "./types.js";

export const RULE_MODULES: readonly LintRuleModule[] = [duplicateJsonLdIdRule];

const RULE_ID_SET = new Set(RULE_MODULES.map((m) => m.ruleId));

export function isKnownRuleId(id: string): boolean {
  return RULE_ID_SET.has(id);
}

export function collectRegistryJsonLdGraphDiagnostics(
  doc: Record<string, unknown>,
  ctx: LintContext,
): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  for (const mod of RULE_MODULES) {
    if (mod.lintJsonLdGraph) {
      out.push(...mod.lintJsonLdGraph(doc, ctx));
    }
  }
  return out;
}

export function collectRegistryLexiconWrapperDiagnostics(
  doc: Record<string, unknown> & { lexicon: Record<string, unknown> },
  ctx: LintContext,
): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  for (const mod of RULE_MODULES) {
    if (mod.lintLexiconWrapper) {
      out.push(...mod.lintLexiconWrapper(doc, ctx));
    }
  }
  return out;
}
