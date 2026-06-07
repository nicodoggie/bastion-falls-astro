import fs from "node:fs";

import { ItemDataSchema } from "@bastion-falls/5e-schema-zod";
import type { z } from "zod";

import {
  readContentDataFile,
  resolveContentDataFilePath,
} from "./content-data-file";
import { buildResolvedItem, type ItemJson, type ResolvedItem } from "./items";
import { getContentDocsDir } from "./paths";
import { warnOnce } from "./warn";

type ItemData = z.infer<typeof ItemDataSchema>;

function safeResolveUnderContentDocs(rel: string): string | null {
  return resolveContentDataFilePath(rel, getContentDocsDir());
}

function normalizeLookup(s: string): string {
  return s.trim().toLowerCase();
}

function extractItemRecord(
  raw: unknown,
  pickName: string | undefined,
  context: string,
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.item)) return raw;
  const arr = o.item.filter((x) => x && typeof x === "object");
  if (arr.length === 0) return null;
  if (!pickName?.trim()) {
    if (arr.length > 1) {
      warnOnce(
        `item-json-multi:${context}`,
        `Item JSON has ${String(arr.length)} items; using the first. ` +
          `Pass Item name="..." to pick one.`,
      );
    }
    return arr[0];
  }
  const want = normalizeLookup(pickName);
  const hit = arr.find(
    (item) =>
      normalizeLookup(String((item as { name?: string }).name ?? "")) === want,
  );
  if (!hit) {
    warnOnce(
      `item-json-name:${context}:${want}`,
      `No item named "${pickName}" in ${context}.`,
    );
    return null;
  }
  return hit;
}

function itemDataToItemJson(parsed: ItemData): ItemJson {
  return {
    name: parsed.name,
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    type: parsed.type,
    rarity: parsed.rarity,
    reqAttune: parsed.reqAttune,
    weight: parsed.weight,
    value: parsed.value,
    ac: parsed.ac,
    bonusAc: parsed.bonusAc,
    dmg1: parsed.dmg1,
    dmg2: parsed.dmg2,
    dmgType: typeof parsed.dmgType === "string" ? parsed.dmgType : undefined,
    entries: parsed.entries as ItemJson["entries"],
    additionalEntries:
      parsed.additionalEntries as ItemJson["additionalEntries"],
  };
}

export function resolveItemFromData(
  data: unknown,
  context: string,
): ResolvedItem | null {
  const parsed = ItemDataSchema.safeParse(data);
  if (!parsed.success) {
    warnOnce(
      `item-data-invalid:${context}`,
      `Item data failed validation (${context}): ${parsed.error.message}`,
    );
    return null;
  }
  return buildResolvedItem(itemDataToItemJson(parsed.data));
}

export function loadItemFromContentJson(
  relativeToContentDocs: string,
  pickName?: string,
): ResolvedItem | null {
  const abs = safeResolveUnderContentDocs(relativeToContentDocs);
  if (!abs) {
    warnOnce(
      `item-json-path:${relativeToContentDocs}`,
      `Invalid or unsafe item JSON path: "${relativeToContentDocs}" ` +
        `(must stay under src/content/docs).`,
    );
    return null;
  }
  if (!fs.existsSync(abs)) {
    warnOnce(`item-json-missing:${abs}`, `Item JSON not found: ${abs}`);
    return null;
  }
  let raw: unknown;
  try {
    raw = readContentDataFile(abs);
  } catch (e) {
    warnOnce(
      `item-json-read:${abs}`,
      `Could not read item data file ${abs}: ${String(e)}`,
    );
    return null;
  }
  const row = extractItemRecord(raw, pickName, abs);
  if (row == null) return null;
  return resolveItemFromData(row, abs);
}
