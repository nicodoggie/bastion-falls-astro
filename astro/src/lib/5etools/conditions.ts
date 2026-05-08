import fs from "node:fs";
import path from "node:path";

import { entriesToPlain } from "./format-plain";
import { get5etoolsDataDir } from "./paths";
import { warnOnce } from "./warn";

type CondRow = {
  name?: string;
  source?: string;
  entries?: unknown[];
};

let bundle: {
  condition?: CondRow[];
  disease?: CondRow[];
} | null = null;

function loadBundle(): { condition: CondRow[]; disease: CondRow[] } {
  if (!bundle) {
    const p = path.join(get5etoolsDataDir(), "conditionsdiseases.json");
    const raw = fs.readFileSync(p, "utf8");
    bundle = JSON.parse(raw) as {
      condition?: CondRow[];
      disease?: CondRow[];
    };
  }
  return {
    condition: bundle.condition ?? [],
    disease: bundle.disease ?? [],
  };
}

function normalizeLookup(s: string): string {
  return s.trim().toLowerCase();
}

function rankSource(s: string | undefined): number {
  const u = (s ?? "").toUpperCase();
  if (u === "XPHB" || u === "XDMG") return 0;
  if (u === "PHB" || u === "DMG") return 1;
  return 2;
}

export type ResolvedConditionDisease = {
  record: CondRow;
  kind: "condition" | "disease";
  summaryLines: string[];
  body: string;
};

export function loadConditionDisease(
  name: string,
  src: string | undefined,
): ResolvedConditionDisease | null {
  const { condition, disease } = loadBundle();
  const rows: Array<{ r: CondRow; kind: "condition" | "disease" }> = [
    ...condition.map((r) => ({ r, kind: "condition" as const })),
    ...disease.map((r) => ({ r, kind: "disease" as const })),
  ];

  const targetName = normalizeLookup(name);
  const matches = rows.filter((x) => normalizeLookup(x.r.name ?? "") === targetName);

  if (matches.length === 0) {
    warnOnce(
      `cond-not-found:${targetName}`,
      `Condition or disease not found: "${name}".`,
    );
    return null;
  }

  let chosen: (typeof matches)[number];

  if (src?.trim()) {
    const targetSrc = src.trim().toUpperCase();
    const exact = matches.filter((x) => (x.r.source ?? "").toUpperCase() === targetSrc);
    if (exact.length === 0) {
      warnOnce(
        `cond-bad-src:${targetName}:${targetSrc}`,
        `Condition/disease "${name}" has no entry for source "${src}".`,
      );
      return null;
    }
    if (exact.length > 1) {
      warnOnce(
        `cond-dup-src:${targetName}:${targetSrc}`,
        `Multiple condition/disease rows for "${name}" / "${src}"; using the first.`,
      );
    }
    const head = exact[0];
    if (!head) return null;
    chosen = head;
  } else {
    const sorted = [...matches].sort(
      (a, b) => rankSource(a.r.source) - rankSource(b.r.source),
    );
    const head = sorted[0];
    if (!head) return null;
    chosen = head;
    const sources = [...new Set(matches.map((m) => m.r.source).filter(Boolean))];
    if (sources.length > 1) {
      warnOnce(
        `cond-ambiguous:${targetName}`,
        `Condition/disease "${name}" exists in multiple sources (${sources.join(", ")}); ` +
          `defaulting to revised sources first (XPHB/XDMG over PHB/DMG). Pass \`src\` to pin.`,
      );
    }
  }

  const summaryLines = [
    chosen.kind === "disease" ? "Disease" : "Condition",
    chosen.r.source ? `Source ${chosen.r.source}` : "",
  ].filter(Boolean);

  return {
    record: chosen.r,
    kind: chosen.kind,
    summaryLines,
    body: entriesToPlain((chosen.r.entries ?? []) as unknown[]),
  };
}
