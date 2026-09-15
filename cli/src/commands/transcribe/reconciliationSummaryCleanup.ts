import { Buffer } from "node:buffer";
import type { SummaryLevel } from "./reconciliationSummaryRepair.js";

const MAX_PROMPT_BYTES = 2_000_000;
const MIN_GROSS_RATIO = 0.1;
const refusalClause =
  /\b(?:cannot|can['’]t|am unable to|won['’]t|will not|refuse to|must refuse|not able to)\s+(?:help|assist|provide|reproduce|generate|summarize|process|continue)\b[^.!?\n]{0,180}\b(?:content|request|material|passages|sexual(?:ized)?|graphic|explicit|children|child|minor)\b/iu;
const plainRefusal = new RegExp(
  `(?:^\\s*(?:sorry[,.!?\\s]+)?(?:i\\s+)?|\\bbut\\s+)${refusalClause.source}`,
  "iu",
);
const editableKey =
  /^(?:text|summarySafeText|heading|nextRollingContext|attribution|confirmationsNeeded|boundaries)$/u;

export type SummaryRefusalDecision = {
  eligible: boolean;
  reason: "refusal" | "not-refusal";
};

export function classifySummaryRefusal(value: unknown): SummaryRefusalDecision {
  if (typeof value === "string")
    return {
      eligible: isPlainRefusal(value),
      reason: isPlainRefusal(value) ? "refusal" : "not-refusal",
    };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["refusal", "contentRefusal", "refused"]) {
      const explicit = record[key];
      if (
        explicit === true ||
        (typeof explicit === "string" && isPlainRefusal(explicit))
      )
        return { eligible: true, reason: "refusal" };
    }
    const narrativeKeys = ["claims", "sections", "openHooks"];
    const narrative = narrativeKeys.map((key) => record[key]);
    const hasNarrativeBoundary =
      narrative.every(Array.isArray) &&
      narrative.every((items) => (items as unknown[]).length === 0) &&
      ["confirmationsNeeded", "boundaries"].some((key) =>
        Array.isArray(record[key]),
      );
    if (
      hasNarrativeBoundary &&
      ["confirmationsNeeded", "boundaries"].some(
        (key) =>
          Array.isArray(record[key]) &&
          (record[key] as unknown[]).some(
            (item) => typeof item === "string" && isPlainRefusal(item),
          ),
      )
    )
      return { eligible: true, reason: "refusal" };
  }
  return { eligible: false, reason: "not-refusal" };
}

function isPlainRefusal(value: string): boolean {
  const text = value.trim();
  if (!plainRefusal.test(text)) return false;
  // Quoted in-world dialogue is narrative data, not an assistant refusal.
  if (/^["“].*["”](?:\s*,|\s+said\b|\s+replied\b)/isu.test(text)) return false;
  return true;
}

function textSize(value: unknown): number {
  if (typeof value === "string") return value.trim().length;
  if (Array.isArray(value))
    return value.reduce((total, item) => total + textSize(item), 0);
  if (typeof value === "object" && value !== null)
    return Object.entries(value).reduce(
      (total, [key, item]) =>
        total + (editableKey.test(key) ? textSize(item) : textSizeNested(item)),
      0,
    );
  return 0;
}

function textSizeNested(value: unknown): number {
  if (typeof value === "string") return 0;
  if (Array.isArray(value))
    return value.reduce((total, item) => total + textSizeNested(item), 0);
  if (typeof value === "object" && value !== null)
    return Object.entries(value).reduce(
      (total, [key, item]) =>
        total + (editableKey.test(key) ? textSize(item) : textSizeNested(item)),
      0,
    );
  return 0;
}

function sameShape(
  source: unknown,
  candidate: unknown,
  path: string[] = [],
): void {
  if (typeof source === "string" || typeof candidate === "string") {
    const key = path.at(-1) ?? "";
    if (!editableKey.test(key)) {
      if (source !== candidate)
        throw new Error(
          `cleanup changed immutable structure field at ${path.join(".")}`,
        );
      return;
    }
    if (typeof candidate !== "string" || candidate.trim() === "")
      throw new Error(`cleanup blank editable text at ${path.join(".")}`);
    return;
  }
  if (Array.isArray(source) || Array.isArray(candidate)) {
    if (
      !Array.isArray(source) ||
      !Array.isArray(candidate) ||
      source.length !== candidate.length
    )
      throw new Error(
        `cleanup changed structure or order at ${path.join(".")}`,
      );
    source.forEach((item, index) => {
      sameShape(item, candidate[index], [...path, String(index)]);
    });
    return;
  }
  if (
    (source && typeof source === "object") ||
    (candidate && typeof candidate === "object")
  ) {
    if (
      !source ||
      !candidate ||
      typeof source !== "object" ||
      typeof candidate !== "object" ||
      Array.isArray(source) ||
      Array.isArray(candidate)
    )
      throw new Error(`cleanup changed structure at ${path.join(".")}`);
    const sourceKeys = Object.keys(source as object).sort();
    const candidateKeys = Object.keys(candidate as object).sort();
    if (JSON.stringify(sourceKeys) !== JSON.stringify(candidateKeys))
      throw new Error(`cleanup changed structure at ${path.join(".")}`);
    for (const key of sourceKeys)
      sameShape(
        (source as Record<string, unknown>)[key],
        (candidate as Record<string, unknown>)[key],
        [...path, key],
      );
  } else if (source !== candidate)
    throw new Error(
      `cleanup changed immutable structure field at ${path.join(".")}`,
    );
}

export function validateSummaryCleanup(
  source: unknown,
  candidate: unknown,
): unknown {
  sameShape(source, candidate);
  const before = textSize(source),
    after = textSize(candidate);
  if (
    before > 0 &&
    (after === 0 || after < Math.ceil(before * MIN_GROSS_RATIO))
  )
    throw new Error("cleanup caused gross narrative compression");
  return candidate;
}

export function buildSummaryCleanupPrompt(
  level: SummaryLevel,
  input: unknown,
): string {
  const prompt = [
    "Return JSON only.",
    `Create a separate ${level} input derivative for one bounded content-refusal recovery attempt.`,
    "Perform non-graphic contextual abstraction of explicit passages into plot-relevant facts, preserving events, consequences, uncertainty, ordering, IDs, provenance, and all non-text structure.",
    "Do not euphemistically disguise explicit content. Do not bypass provider policy. If safe abstraction cannot be produced, return the input unchanged so recovery fails closed.",
    "Only prose text fields may change; do not add, remove, reorder, merge, or split records.",
    "<input>",
    JSON.stringify(input),
    "</input>",
  ].join("\n");
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES)
    throw new Error("summary cleanup prompt exceeds bound");
  return prompt;
}
