import { Buffer } from "node:buffer";
import { z } from "zod";

export const SUMMARY_REPAIR_VERSION = "summary-repair.v1" as const;
export type SummaryLevel = "chunk" | "scene" | "session";
export type SummaryRepairIssue = {
  stage: "json" | "schema" | "semantic";
  code: string;
  path: string[];
  message: string;
  allowed?: string[];
};
export type SummaryRepairContext = {
  level: SummaryLevel;
  originalResponse: unknown;
  issues: readonly SummaryRepairIssue[];
  contract: string;
  authoritativeDomains?: readonly string[];
};
export type SummaryRepairDecision = { eligible: boolean; reason: "eligible" | "timeout" | "abort" | "empty-output" | "output-overflow" | "identity" | "custody" | "diagnostic" | "atomic-publication" | "process" | "unknown" };

const MAX_ISSUES = 128;
const MAX_DEPTH = 16;
const MAX_SEGMENT = 128;
const MAX_MESSAGE = 400;
const MAX_ORIGINAL_BYTES = 2_000_000;
const forbidden = /(?:secret|token|password|credential|authorization|bearer|transcript|(?:\/[A-Za-z0-9_.-]+){2,})/iu;

export function classifySummaryRepair(error: unknown): SummaryRepairDecision {
  const message = error instanceof Error ? error.message : "unknown error";
  const category = typeof error === "object" && error !== null && "repairCategory" in error ? String((error as { repairCategory?: unknown }).repairCategory) : "";
  const stable = `${category}:${message}`.toLowerCase();
  for (const [needle, reason] of [["timeout", "timeout"], ["abort", "abort"], ["empty-output", "empty-output"], ["output-overflow", "output-overflow"], ["identity", "identity"], ["custody", "custody"], ["diagnostic", "diagnostic"], ["atomic-publication", "atomic-publication"], ["process", "process"]] as const) if (category === needle || stable.startsWith(`${needle}:`)) return { eligible: false, reason };
  if (category === "json" || category === "schema" || category === "semantic" || error instanceof z.ZodError) return { eligible: true, reason: "eligible" };
  return { eligible: false, reason: "unknown" };
}

function safePath(path: readonly PropertyKey[]): string[] { return path.slice(0, MAX_DEPTH).map((part) => String(part).slice(0, MAX_SEGMENT)); }
function safeMessage(message: string): string { return (forbidden.test(message) ? "validation feedback omitted for privacy" : message).slice(0, MAX_MESSAGE); }
export function normalizeSummaryRepairIssues(error: unknown): SummaryRepairIssue[] {
  if (error instanceof SyntaxError) return [{ stage: "json", code: "invalid-json", path: [], message: "Response is not valid JSON." }];
  if (error instanceof z.ZodError) return error.issues.slice(0, MAX_ISSUES).map((issue) => ({ stage: "schema", code: issue.code, path: safePath(issue.path), message: safeMessage(issue.message), ...(issue.code === "invalid_value" ? { allowed: (issue as { values?: string[] }).values?.slice(0, 128) } : {}) }));
  const message = error instanceof Error ? error.message : "authoritative validation failed";
  return [{ stage: "semantic", code: "authoritative-validation", path: [], message: safeMessage(message) }];
}
function boundedOriginal(value: unknown): string { let text: string; try { text = JSON.stringify(value, (_key, item) => typeof item === "string" && forbidden.test(item) ? "[redacted]" : item) ?? "[unavailable]"; } catch { text = "[unavailable]"; } if (Buffer.byteLength(text) > MAX_ORIGINAL_BYTES) return text.slice(0, MAX_ORIGINAL_BYTES); return text; }
export function buildSummaryRepairPrompt(context: SummaryRepairContext): string {
  const issues = context.issues.slice(0, MAX_ISSUES).map((issue) => ({ stage: issue.stage, code: issue.code, path: issue.path.slice(0, MAX_DEPTH).map((p) => p.slice(0, MAX_SEGMENT)), message: issue.message.slice(0, MAX_MESSAGE), ...(issue.allowed ? { allowed: issue.allowed.slice(0, 128) } : {}) }));
  const prompt = [
    `Repair one ${context.level} summary using ${SUMMARY_REPAIR_VERSION}.`,
    "Return one structure-only JSON replacement; do not add, omit, merge, reinterpret, or invent evidence, claims, hooks, dispositions, or provenance.",
    "This is the only repair attempt. Do not return commentary or aliases.",
    "<contract>", context.contract, "</contract>",
    "<authoritative-domains>", JSON.stringify(context.authoritativeDomains ?? []), "</authoritative-domains>",
    "<sanitized-issues>", JSON.stringify(issues), "</sanitized-issues>",
    "<original-response-bounded>", boundedOriginal(context.originalResponse), "</original-response-bounded>",
  ].join("\n");
  if (Buffer.byteLength(prompt) > 2_000_000) throw Object.assign(new Error("repair prompt exceeds bound"), { repairCategory: "output-overflow" });
  return prompt;
}
export const SUMMARY_REPAIR_BOUNDS = { maxIssues: MAX_ISSUES, maxPathDepth: MAX_DEPTH, maxPathSegment: MAX_SEGMENT, maxMessage: MAX_MESSAGE, maxPromptBytes: 2_000_000 } as const;
