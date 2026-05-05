import type { LintDiagnostic, LintSeverity } from "../types.js";
import { effectiveRuleSeverity } from "./effective-severity.js";
import type { RuleSeveritySetting } from "./types.js";

export { effectiveRuleSeverity } from "./effective-severity.js";

function settingToLintSeverity(setting: RuleSeveritySetting): LintSeverity {
  return setting === "warn" ? "warning" : "error";
}

/**
 * Drop diagnostics for rules set to `off`; coerce severity for configurable rules.
 */
export function applyRuleSeverities(
  diagnostics: LintDiagnostic[],
  ruleSettings: Partial<Record<string, RuleSeveritySetting>>,
): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  for (const d of diagnostics) {
    if (d.code.startsWith("FIX_")) {
      out.push({ ...d, severity: "error" });
      continue;
    }
    if (!d.ruleId) {
      out.push(d);
      continue;
    }
    const eff = effectiveRuleSeverity(d.ruleId, ruleSettings);
    if (eff === "off") {
      continue;
    }
    out.push({
      ...d,
      severity: settingToLintSeverity(eff),
    });
  }
  return out;
}
