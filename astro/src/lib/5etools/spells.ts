import fs from "node:fs";
import path from "node:path";

import { entriesToPlain, schoolLabel } from "./format-plain";
import { get5etoolsDataDir } from "./paths";
import { warnOnce } from "./warn";

export type SpellJson = {
  name?: string;
  source?: string;
  level?: number;
  school?: string;
  time?: unknown[];
  range?: unknown;
  duration?: unknown[];
  components?: Record<string, unknown>;
  entries?: unknown[];
  entriesHigherLevel?: unknown[];
};

const jsonCache = new Map<string, unknown>();

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

function resolveSpellIndexKey(
  requestedSrc: string,
  index: Record<string, string>,
): string | null {
  const t = requestedSrc.trim();
  if (!t) return null;
  const keys = Object.keys(index);
  const hit = keys.find((k) => k.toLowerCase() === t.toLowerCase());
  return hit ?? null;
}

function rankSpellSource(s: string): number {
  const u = s.toUpperCase();
  if (u === "XPHB") return 0;
  if (u === "PHB") return 1;
  return 2;
}

function formatSpellTime(time: unknown[] | undefined): string {
  if (!time?.length) return "";
  return time
    .map((t) => {
      if (t && typeof t === "object" && "number" in t && "unit" in t) {
        const o = t as { number: number; unit: string };
        return `${o.number} ${o.unit}`;
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

function formatSpellRange(range: unknown): string {
  if (!range || typeof range !== "object") return "";
  const r = range as Record<string, unknown>;
  if (
    typeof r.type === "string" &&
    r.type === "special" &&
    typeof r.entry === "string"
  )
    return r.entry;
  const dist = r.distance;
  if (dist && typeof dist === "object") {
    const d = dist as Record<string, unknown>;
    if (d.type === "feet" && typeof d.amount === "number")
      return `${d.amount} ft.`;
    if (d.type === "miles" && typeof d.amount === "number")
      return `${d.amount} mi.`;
    if (d.type === "self") return "Self";
    if (d.type === "touch") return "Touch";
    if (d.type === "sight") return "Sight";
    if (d.type === "unlimited") return "Unlimited";
  }
  return "";
}

function formatSpellDuration(duration: unknown[] | undefined): string {
  if (!duration?.length) return "";
  return duration
    .map((d) => {
      if (!d || typeof d !== "object") return "";
      const o = d as Record<string, unknown>;
      if (o.type === "instant") return "Instantaneous";
      if (o.type === "special" && typeof o.entry === "string") return o.entry;
      if (o.type === "timed" && o.duration && typeof o.duration === "object") {
        const dur = o.duration as Record<string, unknown>;
        const amt = dur.amount;
        const typ = dur.type;
        if (typeof amt === "number" && typeof typ === "string")
          return `${amt} ${typ}`;
      }
      if (o.type === "permanent") return "Until dispelled";
      return "";
    })
    .filter(Boolean)
    .join("; ");
}

function formatSpellComponents(
  components: Record<string, unknown> | undefined,
): string {
  if (!components) return "";
  const parts: string[] = [];
  if (components.v) parts.push("V");
  if (components.s) parts.push("S");
  if (components.m) {
    parts.push(typeof components.m === "string" ? `M (${components.m})` : "M");
  }
  return parts.join(", ");
}

export type ResolvedSpell = {
  record: SpellJson;
  summaryLines: string[];
  body: string;
};

export function buildResolvedSpell(found: SpellJson): ResolvedSpell {
  const levelLine =
    found.level === 0
      ? `Cantrip · ${schoolLabel(found.school)}`
      : `Level ${found.level} · ${schoolLabel(found.school)}`;

  const summaryLines = [
    levelLine,
    [
      formatSpellTime(found.time),
      formatSpellRange(found.range),
      formatSpellDuration(found.duration),
    ]
      .filter(Boolean)
      .join(" · "),
    formatSpellComponents(found.components),
  ].filter(Boolean);

  const bodyParts = [
    entriesToPlain((found.entries ?? []) as unknown[]),
    entriesToPlain((found.entriesHigherLevel ?? []) as unknown[]),
  ].filter(Boolean);

  return {
    record: found,
    summaryLines,
    body: bodyParts.join(" "),
  };
}

type SpellLoc = { source: string; spell: SpellJson };

let spellsByName: Map<string, SpellLoc[]> | null = null;

function spellNameIndex(): Map<string, SpellLoc[]> {
  if (spellsByName) return spellsByName;
  spellsByName = new Map();
  const dataRoot = get5etoolsDataDir();
  const indexPath = path.join(dataRoot, "spells", "index.json");
  const index = readJson<Record<string, string>>(indexPath);
  for (const [, file] of Object.entries(index)) {
    const spellPath = path.join(dataRoot, "spells", file);
    const bundle = readJson<{ spell?: SpellJson[] }>(spellPath);
    for (const s of bundle.spell ?? []) {
      const nk = normalizeLookup(s.name ?? "");
      if (!nk) continue;
      const src = (s.source ?? "").trim();
      const row = { source: src || "UNKNOWN", spell: s };
      const list = spellsByName.get(nk) ?? [];
      list.push(row);
      spellsByName.set(nk, list);
    }
  }
  return spellsByName;
}

function resolveSpellWithoutSource(name: string): SpellJson | null {
  const targetName = normalizeLookup(name);
  const cand = spellNameIndex().get(targetName) ?? [];
  if (cand.length === 0) {
    warnOnce(
      `spell-not-found:*:${targetName}`,
      `Spell not found: "${name}" (no matching entry across data files).`,
    );
    return null;
  }
  if (cand.length === 1) {
    const row = cand[0];
    return row ? row.spell : null;
  }
  const sorted = [...cand].sort(
    (a, b) => rankSpellSource(a.source) - rankSpellSource(b.source),
  );
  const pick = sorted[0];
  if (!pick) return null;
  const sources = [...new Set(cand.map((c) => c.source))];
  warnOnce(
    `spell-ambiguous:${targetName}`,
    `Spell "${name}" exists in multiple sources (${sources.join(", ")}); ` +
      `defaulting to ${pick.source}. Pass \`src\` to pin a book.`,
  );
  return pick.spell;
}

/**
 * Load a spell by name. When `src` is set, only that book’s shard is read.
 * When `src` is omitted, all shards are indexed (lazy, once) and XPHB is
 * preferred over PHB, with a warning if multiple remain.
 */
export function loadSpell(name: string, src?: string): ResolvedSpell | null {
  const dataRoot = get5etoolsDataDir();
  const indexPath = path.join(dataRoot, "spells", "index.json");
  const index = readJson<Record<string, string>>(indexPath);

  if (src?.trim()) {
    const key = resolveSpellIndexKey(src, index);
    if (!key) {
      warnOnce(
        `spell-bad-src:${src}`,
        `Unknown spell source "${src}" for spell "${name}".`,
      );
      return null;
    }
    const file = index[key];
    if (!file) return null;
    const spellPath = path.join(dataRoot, "spells", file);
    const bundle = readJson<{ spell?: SpellJson[] }>(spellPath);
    const spells = bundle.spell ?? [];
    const targetName = normalizeLookup(name);
    const found = spells.find(
      (s) => normalizeLookup(s.name ?? "") === targetName && s.source === key,
    );
    if (!found) {
      warnOnce(
        `spell-not-found:${key}:${targetName}`,
        `Spell not found: "${name}" from source "${key}" (${file}).`,
      );
      return null;
    }
    return buildResolvedSpell(found);
  }

  const found = resolveSpellWithoutSource(name);
  return found ? buildResolvedSpell(found) : null;
}
