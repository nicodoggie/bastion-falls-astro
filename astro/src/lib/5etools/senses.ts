import fs from "node:fs";
import path from "node:path";

import { entriesToPlain } from "./format-plain";
import { get5etoolsDataDir } from "./paths";
import { warnOnce } from "./warn";

type SenseRow = {
  name?: string;
  source?: string;
  entries?: unknown[];
};

let bundle: { sense?: SenseRow[] } | null = null;

function loadBundle(): SenseRow[] {
  if (!bundle) {
    const p = path.join(get5etoolsDataDir(), "senses.json");
    const raw = fs.readFileSync(p, "utf8");
    bundle = JSON.parse(raw) as { sense?: SenseRow[] };
  }
  return bundle.sense ?? [];
}

function normalizeLookup(s: string): string {
  return s.trim().toLowerCase();
}

function rankSource(s: string | undefined): number {
  const u = (s ?? "").toUpperCase();
  if (u === "XPHB") return 0;
  if (u === "PHB" || u === "MM") return 1;
  return 2;
}

export type ResolvedSense = {
  record: SenseRow;
  summaryLines: string[];
  body: string;
};

export function loadSense(name: string, src?: string): ResolvedSense | null {
  const targetName = normalizeLookup(name);
  const matches = loadBundle().filter((row) => {
    return normalizeLookup(row.name ?? "") === targetName;
  });

  if (matches.length === 0) {
    warnOnce(`sense-not-found:${targetName}`, `Sense not found: "${name}".`);
    return null;
  }

  let chosen: SenseRow | undefined;
  if (src?.trim()) {
    const targetSrc = src.trim().toUpperCase();
    chosen = matches.find(
      (row) => (row.source ?? "").toUpperCase() === targetSrc,
    );
    if (!chosen) {
      warnOnce(
        `sense-bad-src:${targetName}:${targetSrc}`,
        `Sense "${name}" has no entry for source "${src}".`,
      );
      return null;
    }
  } else {
    chosen = [...matches].sort(
      (a, b) => rankSource(a.source) - rankSource(b.source),
    )[0];
    const sources = [
      ...new Set(matches.map((match) => match.source).filter(Boolean)),
    ];
    if (sources.length > 1) {
      warnOnce(
        `sense-ambiguous:${targetName}`,
        `Sense "${name}" exists in multiple sources (${sources.join(", ")}); ` +
          "defaulting to revised sources first (XPHB over PHB/MM). Pass `src` to pin.",
      );
    }
  }

  if (!chosen) return null;
  return {
    record: chosen,
    summaryLines: [
      "Sense",
      chosen.source ? `Source ${chosen.source}` : "",
    ].filter(Boolean),
    body: entriesToPlain((chosen.entries ?? []) as unknown[]),
  };
}
