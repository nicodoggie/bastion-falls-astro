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
  const category = typeof error === "object" && error !== null && "repairCategory" in error ? (error as { repairCategory?: unknown }).repairCategory : undefined;
  if (error instanceof SyntaxError || error instanceof z.ZodError || category === "json" || category === "schema" || category === "semantic-validation") return { eligible: true, reason: "eligible" };
  if (category === "timeout" || category === "abort" || category === "empty-output" || category === "output-overflow" || category === "identity" || category === "custody" || category === "diagnostic" || category === "atomic-publication" || category === "process") return { eligible: false, reason: category };
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
function truncateUtf8(text: string, maxBytes: number): string { if (Buffer.byteLength(text) <= maxBytes) return text; let low = 0; let high = Math.min(text.length, maxBytes); while (low < high) { const middle = Math.ceil((low + high) / 2); if (Buffer.byteLength(text.slice(0, middle)) <= maxBytes) low = middle; else high = middle - 1; } return text.slice(0, low); }
function boundedOriginal(value: unknown): string { let text: string; try { text = JSON.stringify(value, (_key, item) => typeof item === "string" && forbidden.test(item) ? "[redacted]" : item) ?? "[unavailable]"; } catch { text = "[unavailable]"; } return truncateUtf8(text, MAX_ORIGINAL_BYTES); }
export function buildSummaryRepairPrompt(context: SummaryRepairContext): string {
  const issues = context.issues.slice(0, MAX_ISSUES).map((issue) => ({ stage: issue.stage, code: issue.code, path: issue.path.slice(0, MAX_DEPTH).map((p) => p.slice(0, MAX_SEGMENT)), message: issue.message.slice(0, MAX_MESSAGE), ...(issue.allowed ? { allowed: issue.allowed.slice(0, 128).map((value) => value.slice(0, MAX_SEGMENT)) } : {}) }));
  const prefix = [
    `Repair one ${context.level} summary using ${SUMMARY_REPAIR_VERSION}.`,
    "Return one structure-only JSON replacement; do not add, omit, merge, reinterpret, or invent evidence, claims, hooks, dispositions, or provenance.",
    "This is the only repair attempt. Do not return commentary or aliases.",
    "<contract>", context.contract, "</contract>",
    "<authoritative-domains>", JSON.stringify((context.authoritativeDomains ?? []).slice(0, MAX_ISSUES).map((value) => value.slice(0, MAX_SEGMENT))), "</authoritative-domains>",
    "<sanitized-issues>", JSON.stringify(issues), "</sanitized-issues>",
    "<original-response-bounded>\n",
  ].join("\n");
  const suffix = "\n</original-response-bounded>";
  if (Buffer.byteLength(prefix) + Buffer.byteLength(suffix) > SUMMARY_REPAIR_BOUNDS.maxPromptBytes) {
    throw new Error("summary repair prompt framing exceeds bound");
  }
  const original = boundedOriginal(context.originalResponse);
  const available = Math.min(MAX_ORIGINAL_BYTES, SUMMARY_REPAIR_BOUNDS.maxPromptBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix));
  return `${prefix}${truncateUtf8(original, available)}${suffix}`;
}
export const SUMMARY_REPAIR_BOUNDS = { maxIssues: MAX_ISSUES, maxPathDepth: MAX_DEPTH, maxPathSegment: MAX_SEGMENT, maxMessage: MAX_MESSAGE, maxPromptBytes: 2_000_000 } as const;
