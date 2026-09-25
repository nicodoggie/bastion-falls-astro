import { Buffer } from "node:buffer";
import { z } from "zod";
import type { SummaryLevel } from "./reconciliationSummaryRepair.js";

const MAX_PROMPT_BYTES = 2_000_000;
const MIN_GROSS_RATIO = 0.1;
const refusalClause =
  /\b(?:cannot|can['’]t|am unable to|won['’]t|will not|refuse to|must refuse|not able to)\s+(?:help|assist|provide|reproduce|generate|summarize|process|continue)\b[^.!?\n]{0,180}\b(?:content|request|material|passages|sexual(?:ized)?|graphic|explicit|children|child|minor)\b/iu;
const plainRefusal = new RegExp(
  `(?:^\\s*(?:sorry[,.!?\\s]+)?(?:i\\s+)?|\\bbut\\s+)${refusalClause.source}`,
  "iu",
);
function isEditableProsePath(path: readonly string[]): boolean {
  // Cleanup receives a canonical chunk or an array of chunk/scene summaries.
  // A field named `text` inside provenance (e.g. sourceReviewTargets) is immutable.
  const local = /^\d+$/u.test(path[0] ?? "") ? path.slice(1) : path;
  const [collection, index, field] = local;
  if (local.length === 1) return collection === "nextRollingContext";
  if (!/^\d+$/u.test(index ?? "")) return false;
  if (local.length === 2)
    return collection === "confirmationsNeeded" || collection === "boundaries";
  if (local.length !== 3) return false;
  if (collection === "blocks")
    return field === "text" || field === "summarySafeText";
  if (collection === "sections") return field === "text" || field === "heading";
  if (collection === "claims")
    return field === "text" || field === "attribution";
  return (
    (collection === "unresolvedHooks" || collection === "openHooks") &&
    field === "text"
  );
}

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

function textSize(value: unknown, path: string[] = []): number {
  if (typeof value === "string")
    return isEditableProsePath(path) ? value.trim().length : 0;
  if (Array.isArray(value))
    return value.reduce(
      (total, item, index) => total + textSize(item, [...path, String(index)]),
      0,
    );
  if (typeof value === "object" && value !== null)
    return Object.entries(value).reduce(
      (total, [key, item]) => total + textSize(item, [...path, key]),
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
    if (!isEditableProsePath(path)) {
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

export function applySummaryCleanupResponse(
  source: unknown,
  candidate: unknown,
): unknown {
  // Legacy full derivatives still require exact structure. New responses need
  // only identify prose edits; metadata is never regenerated by the model.
  if (!candidate || typeof candidate !== "object" || !("edits" in candidate))
    return validateSummaryCleanup(source, candidate);
  const { edits } = z
    .object({
      edits: z.array(
        z
          .object({
            path: z.array(z.string()).min(1),
            text: z.string().trim().min(1),
          })
          .strict(),
      ),
    })
    .strict()
    .parse(candidate);
  const allowed = new Set(
    editablePaths(source).map((path) => JSON.stringify(path)),
  );
  const replacements = new Map<string, string>();
  for (const edit of edits) {
    const key = JSON.stringify(edit.path);
    if (!allowed.has(key) || replacements.has(key))
      throw new Error("cleanup has unknown or duplicate prose path");
    replacements.set(key, edit.text);
  }
  const rebuild = (value: unknown, path: string[] = []): unknown => {
    const replacement = replacements.get(JSON.stringify(path));
    if (replacement !== undefined) return replacement;
    if (Array.isArray(value))
      return value.map((item, index) =>
        rebuild(item, [...path, String(index)]),
      );
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          rebuild(item, [...path, key]),
        ]),
      );
    return value;
  };
  return validateSummaryCleanup(source, rebuild(source));
}

function editablePaths(value: unknown, path: string[] = []): string[][] {
  if (typeof value === "string") return isEditableProsePath(path) ? [path] : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      editablePaths(item, [...path, String(index)]),
    );
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      editablePaths(item, [...path, key]),
    );
  return [];
}

const HASH_TOKEN = /[0-9a-f]{64}/gu;

function modelFacingCleanupInput(value: unknown): unknown {
  const aliases = new Map<string, string>();
  const redact = (text: string): string =>
    text.replace(HASH_TOKEN, (hash) => {
      const existing = aliases.get(hash);
      if (existing) return existing;
      const alias = `local_ref_${String(aliases.size).padStart(3, "0")}`;
      aliases.set(hash, alias);
      return alias;
    });
  const visit = (candidate: unknown, path: string[] = []): unknown => {
    if (typeof candidate === "string")
      return isEditableProsePath(path) ? candidate : redact(candidate);
    if (Array.isArray(candidate))
      return candidate.map((item, index) => visit(item, [...path, String(index)]));
    if (candidate && typeof candidate === "object")
      return Object.fromEntries(
        Object.entries(candidate).map(([key, item]) => [
          key,
          visit(item, [...path, key]),
        ]),
      );
    return candidate;
  };
  return visit(value);
}

export function buildSummaryCleanupPrompt(
  level: SummaryLevel,
  input: unknown,
): string {
  const prompt = [
    "Return JSON only.",
    `Create a separate ${level} input derivative for one bounded content-refusal recovery attempt.`,
    "Perform non-graphic contextual abstraction of explicit passages into plot-relevant facts, preserving events, consequences, uncertainty, and ordering. Code preserves IDs, provenance, and all non-text structure.",
    'Return exactly {"edits":[{"path":["blocks","0","text"],"text":"replacement prose"}]}. Choose paths only from editablePaths below; omit unchanged fields. Do not echo hashes, metadata, or whole records. Each path may appear at most once.',
    'Do not euphemistically disguise explicit content. Do not bypass provider policy. If safe abstraction cannot be produced, return {"edits":[]} so the unchanged input retries and recovery fails closed if refused again.',
    "Only prose text fields may change; do not add, remove, reorder, merge, or split records.",
    JSON.stringify({ editablePaths: editablePaths(input) }),
    "<input>",
    JSON.stringify(modelFacingCleanupInput(input)),
    "</input>",
  ].join("\n");
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES)
    throw new Error("summary cleanup prompt exceeds bound");
  return prompt;
}
