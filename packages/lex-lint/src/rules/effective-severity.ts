import { RULE_DUPLICATE_JSONLD_ID } from "./rule-ids.js";
import type { RuleSeveritySetting } from "./types.js";

/** Must stay aligned with each rule module's `defaultSeverity`. */
const RULE_DEFAULT_SEVERITIES: Record<string, RuleSeveritySetting> = {
  [RULE_DUPLICATE_JSONLD_ID]: "error",
};

export function effectiveRuleSeverity(
  ruleId: string,
  ruleSettings: Partial<Record<string, RuleSeveritySetting>>,
): RuleSeveritySetting {
  const override = ruleSettings[ruleId];
  if (override !== undefined) {
    return override;
  }
  return RULE_DEFAULT_SEVERITIES[ruleId] ?? "error";
}
