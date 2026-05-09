import fs from "node:fs";
import path from "node:path";

import { SpellDataSchema } from "@bastion-falls/5e-schema-zod";
import type { z } from "zod";

import { getContentDocsDir } from "./paths";
import {
  buildResolvedSpell,
  type ResolvedSpell,
  type SpellJson,
} from "./spells";
import { warnOnce } from "./warn";

type SpellData = z.infer<typeof SpellDataSchema>;

function safeResolveUnderContentDocs(rel: string): string | null {
  const raw = rel.trim().replace(/^[/\\]+/, "");
  if (!raw || raw.includes("\0")) return null;
  const base = path.resolve(getContentDocsDir());
  const abs = path.normalize(path.resolve(base, raw));
  const relToBase = path.relative(base, abs);
  if (relToBase.startsWith("..") || path.isAbsolute(relToBase)) return null;
  return abs;
}

function normalizeLookup(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * If root JSON is `{ "spell": [ ... ] }`, pick one row; otherwise use root as
 * one spell object.
 */
function extractSpellRecord(
  raw: unknown,
  pickName: string | undefined,
  context: string,
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.spell)) return raw;
  const arr = o.spell.filter((x) => x && typeof x === "object");
  if (arr.length === 0) return null;
  if (!pickName?.trim()) {
    if (arr.length > 1) {
      warnOnce(
        `spell-json-multi:${context}`,
        `Spell JSON has ${String(arr.length)} spells; using the first. ` +
          `Pass Spell name="..." to pick one.`,
      );
    }
    return arr[0];
  }
  const want = normalizeLookup(pickName);
  const hit = arr.find(
    (s) =>
      normalizeLookup(String((s as { name?: string }).name ?? "")) === want,
  );
  if (!hit) {
    warnOnce(
      `spell-json-name:${context}:${want}`,
      `No spell named "${pickName}" in ${context}.`,
    );
    return null;
  }
  return hit;
}

function normalizeComponents(
  c: SpellData["components"],
): Record<string, unknown> | undefined {
  if (!c) return undefined;
  const out: Record<string, unknown> = {
    v: c.v,
    s: c.s,
    r: c.r,
  };
  const m = c.m;
  if (m === undefined) return out;
  if (typeof m === "string" || typeof m === "boolean") {
    out.m = m;
  } else if (typeof m === "object" && m !== null && "text" in m) {
    out.m = (m as { text: string }).text;
  } else {
    out.m = m;
  }
  return out;
}

function spellDataToSpellJson(parsed: SpellData): SpellJson {
  let duration: unknown[] | undefined;
  if (Array.isArray(parsed.duration)) {
    duration = parsed.duration as unknown[];
  } else if (parsed.duration != null && typeof parsed.duration === "object") {
    duration = [parsed.duration as unknown];
  }

  let school: string | undefined;
  if (typeof parsed.school === "string") school = parsed.school;

  return {
    name: parsed.name,
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    level: parsed.level,
    school,
    time: parsed.time as SpellJson["time"],
    range: parsed.range as SpellJson["range"],
    duration,
    components: normalizeComponents(parsed.components),
    entries: parsed.entries as SpellJson["entries"],
    entriesHigherLevel:
      parsed.entriesHigherLevel as SpellJson["entriesHigherLevel"],
  };
}

/** Validate and build tooltip payload from arbitrary JSON (import or file). */
export function resolveSpellFromData(
  data: unknown,
  context: string,
): ResolvedSpell | null {
  const parsed = SpellDataSchema.safeParse(data);
  if (!parsed.success) {
    warnOnce(
      `spell-data-invalid:${context}`,
      `Spell data failed validation (${context}): ${parsed.error.message}`,
    );
    return null;
  }
  return buildResolvedSpell(spellDataToSpellJson(parsed.data));
}

/**
 * Load spell JSON under `src/content/docs/`. Path is relative to that folder,
 * e.g. `world/misc/examples/fire-bolt.spell.json`.
 * Optional `pickName` selects an entry when the file is `{ "spell": [...] }`.
 */
export function loadSpellFromContentJson(
  relativeToContentDocs: string,
  pickName?: string,
): ResolvedSpell | null {
  const abs = safeResolveUnderContentDocs(relativeToContentDocs);
  if (!abs) {
    warnOnce(
      `spell-json-path:${relativeToContentDocs}`,
      `Invalid or unsafe spell JSON path: "${relativeToContentDocs}" ` +
        `(must stay under src/content/docs).`,
    );
    return null;
  }
  if (!fs.existsSync(abs)) {
    warnOnce(`spell-json-missing:${abs}`, `Spell JSON not found: ${abs}`);
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
  } catch (e) {
    warnOnce(
      `spell-json-read:${abs}`,
      `Could not read spell JSON ${abs}: ${String(e)}`,
    );
    return null;
  }
  const row = extractSpellRecord(raw, pickName, abs);
  if (row == null) return null;
  return resolveSpellFromData(row, abs);
}
