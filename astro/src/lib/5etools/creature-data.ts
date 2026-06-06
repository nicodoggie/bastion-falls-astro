import fs from "node:fs";
import path from "node:path";

import { CreatureDataSchema } from "@bastion-falls/5e-schema-zod";
import type { z } from "zod";

import {
  buildResolvedCreature,
  type CreatureJson,
  type ResolvedCreature,
} from "./creatures";
import { getContentDocsDir } from "./paths";
import { warnOnce } from "./warn";

type CreatureData = z.infer<typeof CreatureDataSchema>;

const HOME_SOURCE = "BF";

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

function extractCreatureRecord(
  raw: unknown,
  pickName: string | undefined,
  context: string,
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.monster)) return raw;
  const arr = o.monster.filter((x) => x && typeof x === "object");
  if (arr.length === 0) return null;
  if (!pickName?.trim()) {
    if (arr.length > 1) {
      warnOnce(
        `creature-json-multi:${context}`,
        `Creature JSON has ${String(arr.length)} monsters; using the first. ` +
          `Pass Creature name="..." to pick one.`,
      );
    }
    return arr[0];
  }
  const want = normalizeLookup(pickName);
  const hit = arr.find(
    (creature) =>
      normalizeLookup(String((creature as { name?: string }).name ?? "")) ===
      want,
  );
  if (!hit) {
    warnOnce(
      `creature-json-name:${context}:${want}`,
      `No creature named "${pickName}" in ${context}.`,
    );
    return null;
  }
  return hit;
}

function withHomeSource(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  if ("source" in data) return data;
  return { source: HOME_SOURCE, ...(data as Record<string, unknown>) };
}

function creatureDataToCreatureJson(parsed: CreatureData): CreatureJson {
  return {
    name: parsed.name,
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    size: parsed.size,
    type: parsed.type,
    alignment: parsed.alignment as CreatureJson["alignment"],
    ac: parsed.ac as CreatureJson["ac"],
    hp: parsed.hp,
    cr: parsed.cr,
    trait: parsed.trait as CreatureJson["trait"],
    action: parsed.action as CreatureJson["action"],
    bonus: parsed.bonus as CreatureJson["bonus"],
    reaction: parsed.reaction as CreatureJson["reaction"],
    legendary: parsed.legendary as CreatureJson["legendary"],
  };
}

export function resolveCreatureFromData(
  data: unknown,
  context: string,
): ResolvedCreature | null {
  const parsed = CreatureDataSchema.safeParse(withHomeSource(data));
  if (!parsed.success) {
    warnOnce(
      `creature-data-invalid:${context}`,
      `Creature data failed validation (${context}): ${parsed.error.message}`,
    );
    return null;
  }
  return buildResolvedCreature(creatureDataToCreatureJson(parsed.data));
}

export function loadCreatureFromContentJson(
  relativeToContentDocs: string,
  pickName?: string,
): ResolvedCreature | null {
  const abs = safeResolveUnderContentDocs(relativeToContentDocs);
  if (!abs) {
    warnOnce(
      `creature-json-path:${relativeToContentDocs}`,
      `Invalid or unsafe creature JSON path: "${relativeToContentDocs}" ` +
        `(must stay under src/content/docs).`,
    );
    return null;
  }
  if (!fs.existsSync(abs)) {
    warnOnce(
      `creature-json-missing:${abs}`,
      `Creature JSON not found: ${abs}`,
    );
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
  } catch (e) {
    warnOnce(
      `creature-json-read:${abs}`,
      `Could not read creature JSON ${abs}: ${String(e)}`,
    );
    return null;
  }
  const row = extractCreatureRecord(raw, pickName, abs);
  if (row == null) return null;
  return resolveCreatureFromData(row, abs);
}
