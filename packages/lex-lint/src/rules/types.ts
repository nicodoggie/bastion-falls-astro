import type { LintDiagnostic } from "../types.js";

/** Values stored in config JSON under `rules.<ruleId>`. */
export type RuleSeveritySetting = "off" | "warn" | "error";

export type LintContext = {
  filePath: string;
  ruleSettings: Partial<Record<string, RuleSeveritySetting>>;
};

export type FixContext = {
  filePath: string;
  ruleSettings: Partial<Record<string, RuleSeveritySetting>>;
  dryRun: boolean;
};

export type FixResult = {
  doc: unknown;
  ok: boolean;
  diagnostics?: LintDiagnostic[];
};

export type LintRuleModule = {
  ruleId: string;
  defaultSeverity: RuleSeveritySetting;
  /** Diagnostic `code` values this rule emits (lint path). */
  codes: readonly string[];
  lintJsonLdGraph?: (
    doc: Record<string, unknown>,
    ctx: LintContext,
  ) => LintDiagnostic[];
  lintLexiconWrapper?: (
    doc: Record<string, unknown> & { lexicon: Record<string, unknown> },
    ctx: LintContext,
  ) => LintDiagnostic[];
  fix?: (doc: unknown, ctx: FixContext) => FixResult;
};
