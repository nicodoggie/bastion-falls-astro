import fs from "node:fs";
import path from "node:path";

import { entriesToPlain } from "./format-plain";
import { get5etoolsDataDir } from "./paths";
import { warnOnce } from "./warn";

type FeatJson = {
  name?: string;
  source?: string;
  category?: string;
  prerequisite?: unknown[];
  entries?: unknown[];
};

let featsBundle: { feat?: FeatJson[] } | null = null;

function loadFeatsFile(): FeatJson[] {
  if (!featsBundle) {
    const p = path.join(get5etoolsDataDir(), "feats.json");
    const raw = fs.readFileSync(p, "utf8");
    featsBundle = JSON.parse(raw) as { feat?: FeatJson[] };
  }
  return featsBundle.feat ?? [];
}

function normalizeLookup(s: string): string {
  return s.trim().toLowerCase();
}

export type ResolvedFeat = {
  record: FeatJson;
  summaryLines: string[];
  body: string;
};

function formatFeatPrereq(prereq: unknown[] | undefined): string {
  if (!prereq?.length) return "";
  const lines: string[] = [];
  for (const p of prereq) {
    if (p && typeof p === "object" && "other" in p) {
      const o = (p as { other?: unknown }).other;
      if (typeof o === "string") lines.push(o);
    }
  }
  if (lines.length) return lines.join("; ");
  return "Requires prerequisites (see source)";
}

export function loadFeat(name: string, src: string): ResolvedFeat | null {
  const feats = loadFeatsFile();
  const targetName = normalizeLookup(name);
  const targetSrc = src.trim().toUpperCase();
  const found = feats.find(
    (f) =>
      normalizeLookup(f.name ?? "") === targetName &&
      (f.source ?? "").toUpperCase() === targetSrc,
  );
  if (!found) {
    warnOnce(
      `feat-not-found:${targetSrc}:${targetName}`,
      `Feat not found: "${name}" from source "${src}".`,
    );
    return null;
  }

  const summaryLines: string[] = [];
  if (found.category) summaryLines.push(`Category ${found.category}`);
  const p = formatFeatPrereq(found.prerequisite as unknown[] | undefined);
  if (p) summaryLines.push(`Prerequisite: ${p}`);

  return {
    record: found,
    summaryLines,
    body: entriesToPlain((found.entries ?? []) as unknown[]),
  };
}
