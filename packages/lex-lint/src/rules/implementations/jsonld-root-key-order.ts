import type { LintDiagnostic } from "../../types.js";
import { RULE_JSONLD_ROOT_KEY_ORDER } from "../rule-ids.js";
import type { LintContext, LintRuleModule } from "../types.js";

export const CODE_JSONLD_ROOT_CONTEXT_NOT_FIRST =
  "JSONLD_ROOT_CONTEXT_NOT_FIRST";
export const CODE_JSONLD_ROOT_GRAPH_NOT_LAST = "JSONLD_ROOT_GRAPH_NOT_LAST";

export function lintJsonLdRootKeyOrder(
  doc: Record<string, unknown>,
  ctx: LintContext,
): LintDiagnostic[] {
  const keys = Object.keys(doc);
  const out: LintDiagnostic[] = [];

  if ("@context" in doc && keys[0] !== "@context") {
    out.push({
      severity: "warning",
      code: CODE_JSONLD_ROOT_CONTEXT_NOT_FIRST,
      ruleId: RULE_JSONLD_ROOT_KEY_ORDER,
      message:
        'Prefer "@context" as the first root key for human-readable JSON-LD.',
      file: ctx.filePath,
    });
  }

  if ("@graph" in doc && keys[keys.length - 1] !== "@graph") {
    out.push({
      severity: "warning",
      code: CODE_JSONLD_ROOT_GRAPH_NOT_LAST,
      ruleId: RULE_JSONLD_ROOT_KEY_ORDER,
      message:
        'Prefer "@graph" as the last root key so metadata precedes entries.',
      file: ctx.filePath,
    });
  }

  return out;
}

export const jsonldRootKeyOrderRule: LintRuleModule = {
  ruleId: RULE_JSONLD_ROOT_KEY_ORDER,
  defaultSeverity: "warn",
  codes: [
    CODE_JSONLD_ROOT_CONTEXT_NOT_FIRST,
    CODE_JSONLD_ROOT_GRAPH_NOT_LAST,
  ],
  lintJsonLdGraph: lintJsonLdRootKeyOrder,
};
