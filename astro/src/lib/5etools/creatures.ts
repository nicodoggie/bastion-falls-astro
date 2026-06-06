import fs from "node:fs";
import path from "node:path";

import { entriesToPlain } from "./format-plain";
import { get5etoolsDataDir } from "./paths";
import { warnOnce } from "./warn";

export type CreatureJson = {
  name?: string;
  source?: string;
  size?: string[];
  type?: unknown;
  alignment?: unknown[];
  ac?: unknown[];
  hp?: unknown;
  cr?: unknown;
  trait?: { name?: string; entries?: unknown[] }[];
  action?: { name?: string; entries?: unknown[] }[];
  bonus?: { name?: string; entries?: unknown[] }[];
  reaction?: { name?: string; entries?: unknown[] }[];
  legendary?: { name?: string; entries?: unknown[] }[];
};

export type ResolvedCreature = {
  record: CreatureJson;
  summaryLines: string[];
  body: string;
};

type CreatureLoc = { source: string; creature: CreatureJson };

const SIZE_NAMES: Record<string, string> = {
  T: "Tiny",
  S: "Small",
  M: "Medium",
  L: "Large",
  H: "Huge",
  G: "Gargantuan",
};

const ALIGN_MAP: Record<string, string> = {
  L: "Lawful",
  C: "Chaotic",
  N: "Neutral",
  NX: "Neutral",
  NY: "Neutral",
  G: "Good",
  E: "Evil",
  U: "Unaligned",
  A: "Any alignment",
};

const jsonCache = new Map<string, unknown>();
let creaturesByName: Map<string, CreatureLoc[]> | null = null;

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

function rankCreatureSource(s: string): number {
  const u = s.toUpperCase();
  if (u === "XMM") return 0;
  if (u === "MM") return 1;
  return 2;
}

function formatSize(sizes: string[] | undefined): string {
  if (!sizes?.length) return "";
  return sizes.map((size) => SIZE_NAMES[size] ?? size).join(" or ");
}

function formatType(type: unknown): string {
  if (!type) return "";
  if (typeof type === "string") return type;
  if (typeof type === "object" && type !== null) {
    const inner = (type as Record<string, unknown>).type;
    if (typeof inner === "string") return inner;
  }
  return "";
}

function formatAlignment(alignment: unknown[] | undefined): string {
  if (!alignment?.length) return "";
  const parts = alignment.flatMap((a) => {
    if (typeof a === "string") {
      if (a === "A") return ["Any alignment"];
      if (a === "U") return ["Unaligned"];
      return [ALIGN_MAP[a] ?? a];
    }
    if (a && typeof a === "object") {
      if ("special" in a) return [String((a as { special: unknown }).special)];
      if ("alignment" in a) {
        return [formatAlignment((a as { alignment: unknown[] }).alignment)];
      }
    }
    return [];
  });
  if (parts.join(" ") === "Neutral Neutral") return "True Neutral";
  if (parts.includes("Any alignment")) return "Any alignment";
  return parts.join(" ");
}

function formatAC(ac: unknown[] | undefined): string {
  if (!ac?.length) return "";
  const first = ac[0];
  if (typeof first === "number") return String(first);
  if (first && typeof first === "object" && "ac" in first) {
    return String((first as { ac: unknown }).ac);
  }
  return "";
}

function formatHP(hp: unknown): string {
  if (!hp || typeof hp !== "object") return "";
  const avg = (hp as Record<string, unknown>).average;
  return typeof avg === "number" ? String(avg) : "";
}

function formatCR(cr: unknown): string {
  if (typeof cr === "string") return cr;
  if (cr && typeof cr === "object" && "cr" in cr) {
    return String((cr as { cr: unknown }).cr);
  }
  return "";
}

function formatFeature(feature: { name?: string; entries?: unknown[] }): string {
  const body = entriesToPlain(feature.entries ?? []);
  if (!feature.name) return body;
  return body ? `${feature.name}. ${body}` : feature.name;
}

export function buildResolvedCreature(found: CreatureJson): ResolvedCreature {
  const metaLine = [
    [formatSize(found.size), formatType(found.type)].filter(Boolean).join(" "),
    formatAlignment(found.alignment),
  ]
    .filter(Boolean)
    .join(" · ");

  const statLine = [
    formatCR(found.cr) ? `CR ${formatCR(found.cr)}` : "",
    formatAC(found.ac) ? `AC ${formatAC(found.ac)}` : "",
    formatHP(found.hp) ? `HP ${formatHP(found.hp)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const bodyParts = [
    ...(found.trait ?? []),
    ...(found.action ?? []),
    ...(found.bonus ?? []),
    ...(found.reaction ?? []),
    ...(found.legendary ?? []),
  ]
    .map(formatFeature)
    .filter(Boolean);

  return {
    record: found,
    summaryLines: [metaLine, statLine].filter(Boolean),
    body: bodyParts.join(" "),
  };
}

function creatureNameIndex(): Map<string, CreatureLoc[]> {
  if (creaturesByName) return creaturesByName;
  creaturesByName = new Map();
  const bestiaryDir = path.join(get5etoolsDataDir(), "bestiary");
  const files = fs
    .readdirSync(bestiaryDir)
    .filter((file) => /^bestiary-.*\.json$/.test(file));
  for (const file of files) {
    const bundlePath = path.join(bestiaryDir, file);
    const bundle = readJson<{ monster?: CreatureJson[] }>(bundlePath);
    for (const creature of bundle.monster ?? []) {
      const nk = normalizeLookup(creature.name ?? "");
      if (!nk) continue;
      const src = (creature.source ?? "").trim();
      const row = { source: src || "UNKNOWN", creature };
      const list = creaturesByName.get(nk) ?? [];
      list.push(row);
      creaturesByName.set(nk, list);
    }
  }
  return creaturesByName;
}

export function loadCreature(
  name: string,
  src?: string,
): ResolvedCreature | null {
  const targetName = normalizeLookup(name);
  const candidates = creatureNameIndex().get(targetName) ?? [];
  if (candidates.length === 0) {
    warnOnce(
      `creature-not-found:*:${targetName}`,
      `Creature not found: "${name}" (no matching entry across bestiary files).`,
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
        `creature-not-found:${src}:${targetName}`,
        `Creature not found: "${name}" from source "${src}".`,
      );
      return null;
    }
    return buildResolvedCreature(found.creature);
  }

  if (candidates.length === 1) {
    return buildResolvedCreature(candidates[0]!.creature);
  }
  const sorted = [...candidates].sort(
    (a, b) => rankCreatureSource(a.source) - rankCreatureSource(b.source),
  );
  const pick = sorted[0];
  if (!pick) return null;
  const sources = [...new Set(candidates.map((candidate) => candidate.source))];
  warnOnce(
    `creature-ambiguous:${targetName}`,
    `Creature "${name}" exists in multiple sources (${sources.join(", ")}); ` +
      `defaulting to ${pick.source}. Pass \`src\` to pin a book.`,
  );
  return buildResolvedCreature(pick.creature);
}
