import type { LintDiagnostic } from "../../types.js";
import { effectiveRuleSeverity } from "../effective-severity.js";
import type { FixContext, FixResult, LintContext, LintRuleModule } from "../types.js";
import { RULE_DUPLICATE_JSONLD_ID } from "../rule-ids.js";

export const CODE_DUPLICATE_JSON_LD_ID = "DUPLICATE_JSON_LD_ID";
export const CODE_FIX_SKIPPED_CONFLICT = "FIX_SKIPPED_CONFLICT";

/** Keys merged by concatenating arrays (sense-like). */
const MERGE_ARRAY_KEYS = new Set(["sense", "ontolex:sense"]);

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
  } catch {
    return false;
  }
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = sortKeysDeep(obj[k]);
  }
  return sorted;
}

export function stringifyLexiconDoc(doc: unknown): string {
  return `${JSON.stringify(sortKeysDeep(doc), null, 2)}\n`;
}

function normalizeTypeArray(v: unknown): unknown[] {
  if (v === undefined || v === null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

function unionTypes(a: unknown, b: unknown): unknown {
  const ta = normalizeTypeArray(a);
  const tb = normalizeTypeArray(b);
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const t of [...ta, ...tb]) {
    const key = JSON.stringify(sortKeysDeep(t));
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(t);
  }
  if (out.length === 0) {
    return undefined;
  }
  if (out.length === 1) {
    return out[0];
  }
  return out;
}

function normalizeSenseArray(v: unknown): unknown[] {
  if (v === undefined || v === null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

function mergeSenseLike(a: unknown, b: unknown): unknown {
  const merged = [...normalizeSenseArray(a), ...normalizeSenseArray(b)];
  if (merged.length === 0) {
    return undefined;
  }
  if (merged.length === 1) {
    return merged[0];
  }
  return merged;
}

function mergeLexicalObjects(
  survivor: Record<string, unknown>,
  dup: Record<string, unknown>,
): { ok: true } | { ok: false; diagnostic: LintDiagnostic } {
  const skipKeys = new Set(["@id", "@context"]);

  if ("canonicalForm" in dup || "canonicalForm" in survivor) {
    const sc = survivor["canonicalForm"];
    const dc = dup["canonicalForm"];
    if (dc === undefined) {
      /* keep survivor */
    } else if (sc === undefined) {
      survivor["canonicalForm"] = dc;
    } else if (!deepEqual(sc, dc)) {
      return {
        ok: false,
        diagnostic: {
          severity: "error",
          code: CODE_FIX_SKIPPED_CONFLICT,
          ruleId: RULE_DUPLICATE_JSONLD_ID,
          message:
            "Cannot merge duplicate @id: conflicting canonicalForm values.",
        },
      };
    }
  }

  const st = unionTypes(survivor["@type"], dup["@type"]);
  if (st !== undefined) {
    survivor["@type"] = st;
  }

  for (const key of MERGE_ARRAY_KEYS) {
    if (!(key in dup) && !(key in survivor)) {
      continue;
    }
    const merged = mergeSenseLike(survivor[key], dup[key]);
    if (merged !== undefined) {
      survivor[key] = merged;
    }
  }

  for (const key of Object.keys(dup)) {
    if (skipKeys.has(key) || key === "@type" || MERGE_ARRAY_KEYS.has(key)) {
      continue;
    }
    if (key === "canonicalForm") {
      continue;
    }
    if (!(key in survivor)) {
      survivor[key] = dup[key];
      continue;
    }
    if (deepEqual(survivor[key], dup[key])) {
      continue;
    }
    return {
      ok: false,
      diagnostic: {
        severity: "error",
        code: CODE_FIX_SKIPPED_CONFLICT,
        ruleId: RULE_DUPLICATE_JSONLD_ID,
        message: `Cannot merge duplicate @id: conflicting property "${key}".`,
      },
    };
  }

  return { ok: true };
}

export function lintDuplicateIdsJsonLdGraph(
  doc: Record<string, unknown>,
  ctx: LintContext,
): LintDiagnostic[] {
  const graph = doc["@graph"];
  if (!Array.isArray(graph)) {
    return [];
  }

  const idToIndices = new Map<string, number[]>();
  graph.forEach((node, idx) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }
    const idVal = (node as Record<string, unknown>)["@id"];
    if (typeof idVal !== "string") {
      return;
    }
    const id = idVal.trim();
    if (id === "") {
      return;
    }
    const arr = idToIndices.get(id) ?? [];
    arr.push(idx);
    idToIndices.set(id, arr);
  });

  const out: LintDiagnostic[] = [];
  for (const [id, indices] of idToIndices) {
    if (indices.length < 2) {
      continue;
    }
    const idxLabel = indices.map((i) => `@graph[${i}]`).join(", ");
    for (const idx of indices) {
      out.push({
        severity: "error",
        code: CODE_DUPLICATE_JSON_LD_ID,
        ruleId: RULE_DUPLICATE_JSONLD_ID,
        message: `Duplicate @id "${id}" (${idxLabel}).`,
        file: ctx.filePath,
        entryKey: `@graph[${idx}]`,
      });
    }
  }
  return out;
}

export function lintDuplicateIdsLexiconWrapper(
  doc: Record<string, unknown> & { lexicon: Record<string, unknown> },
  ctx: LintContext,
): LintDiagnostic[] {
  const idToKeys = new Map<string, string[]>();
  for (const [lexKey, entry] of Object.entries(doc.lexicon)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const graphEntry = (entry as Record<string, unknown>).graphEntry;
    if (
      !graphEntry ||
      typeof graphEntry !== "object" ||
      Array.isArray(graphEntry)
    ) {
      continue;
    }
    const idVal = (graphEntry as Record<string, unknown>)["@id"];
    if (typeof idVal !== "string") {
      continue;
    }
    const id = idVal.trim();
    if (id === "") {
      continue;
    }
    const arr = idToKeys.get(id) ?? [];
    arr.push(lexKey);
    idToKeys.set(id, arr);
  }

  const out: LintDiagnostic[] = [];
  for (const [id, keys] of idToKeys) {
    if (keys.length < 2) {
      continue;
    }
    const label = keys.join(", ");
    for (const lexKey of keys) {
      out.push({
        severity: "error",
        code: CODE_DUPLICATE_JSON_LD_ID,
        ruleId: RULE_DUPLICATE_JSONLD_ID,
        message: `Duplicate graphEntry @id "${id}" (lexicon keys: ${label}).`,
        file: ctx.filePath,
        entryKey: lexKey,
      });
    }
  }
  return out;
}

function fixDuplicatesJsonLdGraphDoc(
  doc: Record<string, unknown>,
  filePath: string,
): FixResult {
  const graph = doc["@graph"];
  if (!Array.isArray(graph)) {
    return { doc, ok: true };
  }

  const idToIndices = new Map<string, number[]>();
  graph.forEach((node, idx) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }
    const idVal = (node as Record<string, unknown>)["@id"];
    if (typeof idVal !== "string") {
      return;
    }
    const id = idVal.trim();
    if (id === "") {
      return;
    }
    const arr = idToIndices.get(id) ?? [];
    arr.push(idx);
    idToIndices.set(id, arr);
  });

  const diagnostics: LintDiagnostic[] = [];
  const removeIdx = new Set<number>();

  for (const [, indices] of idToIndices) {
    if (indices.length < 2) {
      continue;
    }
    const sorted = [...indices].sort((a, b) => a - b);
    const survivorIdx = sorted[0];
    if (survivorIdx === undefined) {
      continue;
    }
    const survivor = graph[survivorIdx] as Record<string, unknown>;
    for (let i = 1; i < sorted.length; i++) {
      const di = sorted[i];
      if (di === undefined) {
        continue;
      }
      const dup = graph[di] as Record<string, unknown>;
      const merged = mergeLexicalObjects(survivor, dup);
      if (!merged.ok) {
        diagnostics.push({
          ...merged.diagnostic,
          file: filePath,
        });
        return { doc, ok: false, diagnostics };
      }
      graph[survivorIdx] = survivor;
      removeIdx.add(di);
    }
  }

  const descending = [...removeIdx].sort((a, b) => b - a);
  for (const idx of descending) {
    graph.splice(idx, 1);
  }

  return { doc, ok: true, diagnostics };
}

function fixDuplicatesWrapperDoc(
  doc: Record<string, unknown> & { lexicon: Record<string, unknown> },
  filePath: string,
): FixResult {
  const lex = doc.lexicon;
  const idToKeys = new Map<string, string[]>();

  for (const [lexKey, entry] of Object.entries(lex)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const graphEntry = (entry as Record<string, unknown>).graphEntry;
    if (
      !graphEntry ||
      typeof graphEntry !== "object" ||
      Array.isArray(graphEntry)
    ) {
      continue;
    }
    const idVal = (graphEntry as Record<string, unknown>)["@id"];
    if (typeof idVal !== "string") {
      continue;
    }
    const id = idVal.trim();
    if (id === "") {
      continue;
    }
    const arr = idToKeys.get(id) ?? [];
    arr.push(lexKey);
    idToKeys.set(id, arr);
  }

  const diagnostics: LintDiagnostic[] = [];

  for (const [, keys] of idToKeys) {
    if (keys.length < 2) {
      continue;
    }
    const survivorKey = keys[0];
    if (survivorKey === undefined) {
      continue;
    }
    const survivorEntry = lex[survivorKey] as Record<string, unknown>;
    const survivorGe = survivorEntry["graphEntry"] as Record<string, unknown>;

    for (let i = 1; i < keys.length; i++) {
      const dk = keys[i];
      if (dk === undefined) {
        continue;
      }
      const dupEntry = lex[dk] as Record<string, unknown>;
      const dupGe = dupEntry["graphEntry"] as Record<string, unknown>;
      const merged = mergeLexicalObjects(survivorGe, dupGe);
      if (!merged.ok) {
        diagnostics.push({
          ...merged.diagnostic,
          file: filePath,
          entryKey: dk,
        });
        return { doc, ok: false, diagnostics };
      }
      delete lex[dk];
    }
    survivorEntry["graphEntry"] = survivorGe;
  }

  return { doc, ok: true, diagnostics };
}

function fixDuplicateJsonLdId(doc: unknown, ctx: FixContext): FixResult {
  if (
    effectiveRuleSeverity(RULE_DUPLICATE_JSONLD_ID, ctx.ruleSettings) === "off"
  ) {
    return { doc, ok: true };
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { doc, ok: true };
  }

  const o = doc as Record<string, unknown>;
  if ("@graph" in o && "@context" in o) {
    return fixDuplicatesJsonLdGraphDoc(o, ctx.filePath);
  }

  if (
    "lexicon" in o &&
    o.lexicon !== null &&
    typeof o.lexicon === "object" &&
    !Array.isArray(o.lexicon)
  ) {
    return fixDuplicatesWrapperDoc(
      o as Record<string, unknown> & { lexicon: Record<string, unknown> },
      ctx.filePath,
    );
  }

  return { doc, ok: true };
}

export const duplicateJsonLdIdRule: LintRuleModule = {
  ruleId: RULE_DUPLICATE_JSONLD_ID,
  defaultSeverity: "error",
  codes: [CODE_DUPLICATE_JSON_LD_ID, CODE_FIX_SKIPPED_CONFLICT],
  lintJsonLdGraph: lintDuplicateIdsJsonLdGraph,
  lintLexiconWrapper: lintDuplicateIdsLexiconWrapper,
  fix: fixDuplicateJsonLdId,
};