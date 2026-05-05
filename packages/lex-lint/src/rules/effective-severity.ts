import {
  RULE_JSONLD_DUPLICATE_GRAPH_ID,
  RULE_JSONLD_ROOT_KEY_ORDER,
} from "./rule-ids.js";
import type { RuleSeveritySetting } from "./types.js";

/** Must stay aligned with each rule module's `defaultSeverity`. */
const RULE_DEFAULT_SEVERITIES: Record<string, RuleSeveritySetting> = {
  [RULE_JSONLD_DUPLICATE_GRAPH_ID]: "error",
  [RULE_JSONLD_ROOT_KEY_ORDER]: "warn",
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
