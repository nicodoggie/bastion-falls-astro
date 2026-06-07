import fs from "node:fs";
import path from "node:path";

import { entriesToPlain } from "./format-plain";
import {
  formatAttunement,
  formatItemRarity,
  formatItemType,
} from "./item-format";
import { get5etoolsDataDir } from "./paths";
import { warnOnce } from "./warn";

export type ItemJson = {
  name?: string;
  source?: string;
  type?: unknown;
  rarity?: unknown;
  reqAttune?: unknown;
  weight?: number;
  value?: number | null;
  ac?: number;
  bonusAc?: string;
  dmg1?: string;
  dmg2?: string;
  dmgType?: string;
  entries?: unknown[];
  additionalEntries?: unknown[];
};

export type ResolvedItem = {
  record: ItemJson;
  summaryLines: string[];
  body: string;
};

type ItemLoc = { source: string; item: ItemJson };

const jsonCache = new Map<string, unknown>();
let itemsByName: Map<string, ItemLoc[]> | null = null;

function readJson<T>(filePath: string): T {
  if (jsonCache.has(filePath)) return jsonCache.get(filePath) as T;
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw) as T;
  jsonCache.set(filePath, data);
  return data;
}

function normalizeLookup(s: string): string {
  return s.trim().toLowerCase();
}

function rankItemSource(s: string): number {
  const u = s.toUpperCase();
  if (u === "XDMG" || u === "XPHB") return 0;
  if (u === "DMG" || u === "PHB") return 1;
  return 2;
}

function formatCoin(n: number): string {
  const gp = n / 100;
  if (gp >= 1) return `${gp % 1 === 0 ? gp : gp.toFixed(2)} gp`;
  const sp = n / 10;
  if (sp >= 1) return `${sp % 1 === 0 ? sp : sp.toFixed(1)} sp`;
  return `${n} cp`;
}

export function buildResolvedItem(found: ItemJson): ResolvedItem {
  const propertyLine = [
    formatItemType(found.type),
    formatItemRarity(found.rarity),
    formatAttunement(found.reqAttune),
  ]
    .filter(Boolean)
    .join(" · ");

  const statBits: string[] = [];
  if (found.ac != null) statBits.push(`AC ${found.ac}`);
  if (found.bonusAc) statBits.push(`Bonus AC ${found.bonusAc}`);
  if (found.dmg1) {
    let damage = found.dmg1;
    if (found.dmgType) damage += ` ${found.dmgType}`;
    statBits.push(damage);
    if (found.dmg2) statBits.push(`Versatile ${found.dmg2}`);
  }
  if (found.weight != null && Number.isFinite(found.weight)) {
    statBits.push(`${found.weight} lb.`);
  }
  if (typeof found.value === "number" && Number.isFinite(found.value)) {
    statBits.push(formatCoin(found.value));
  }

  const bodyParts = [
    entriesToPlain((found.entries ?? []) as unknown[]),
    entriesToPlain((found.additionalEntries ?? []) as unknown[]),
  ].filter(Boolean);

  return {
    record: found,
    summaryLines: [propertyLine, statBits.join(" · ")].filter(Boolean),
    body: bodyParts.join(" "),
  };
}

function itemNameIndex(): Map<string, ItemLoc[]> {
  if (itemsByName) return itemsByName;
  itemsByName = new Map();
  const dataRoot = get5etoolsDataDir();
  const files = ["items-base.json", "items.json"];
  for (const file of files) {
    const bundlePath = path.join(dataRoot, file);
    const bundle = readJson<{
      baseitem?: ItemJson[];
      item?: ItemJson[];
    }>(bundlePath);
    for (const item of [...(bundle.baseitem ?? []), ...(bundle.item ?? [])]) {
      const nk = normalizeLookup(item.name ?? "");
      if (!nk) continue;
      const src = (item.source ?? "").trim();
      const row = { source: src || "UNKNOWN", item };
      const list = itemsByName.get(nk) ?? [];
      list.push(row);
      itemsByName.set(nk, list);
    }
  }
  return itemsByName;
}

export function loadItem(name: string, src?: string): ResolvedItem | null {
  const targetName = normalizeLookup(name);
  const candidates = itemNameIndex().get(targetName) ?? [];
  if (candidates.length === 0) {
    warnOnce(
      `item-not-found:*:${targetName}`,
      `Item not found: "${name}" (no matching entry across data files).`,
    );
    return null;
  }

  if (src?.trim()) {
    const targetSource = src.trim().toLowerCase();
    const found = candidates.find((row) => {
      return row.source.toLowerCase() === targetSource;
    });
    if (!found) {
      warnOnce(
        `item-not-found:${src}:${targetName}`,
        `Item not found: "${name}" from source "${src}".`,
      );
      return null;
    }
    return buildResolvedItem(found.item);
  }

  if (candidates.length === 1) return buildResolvedItem(candidates[0]?.item);
  const sorted = [...candidates].sort(
    (a, b) => rankItemSource(a.source) - rankItemSource(b.source),
  );
  const pick = sorted[0];
  if (!pick) return null;
  const sources = [...new Set(candidates.map((candidate) => candidate.source))];
  warnOnce(
    `item-ambiguous:${targetName}`,
    `Item "${name}" exists in multiple sources (${sources.join(", ")}); ` +
      `defaulting to ${pick.source}. Pass \`src\` to pin a book.`,
  );
  return buildResolvedItem(pick.item);
}
