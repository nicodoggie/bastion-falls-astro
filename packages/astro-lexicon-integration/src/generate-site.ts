import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { LexItem, LexiconFieldMeta } from "@bastion-falls/types";

import {
  collectFieldsFromItems,
  compileLexiconShard,
  flattenByFieldRows,
  type ByFieldFlatRow,
} from "./compile.js";
import {
  computeLexiconInputFingerprint,
  LEXICON_COMPILER_REVISION,
  LEXICON_STAMP_FILENAME,
  readStampFile,
  type LexiconStampFile,
} from "./fingerprint.js";
import { MANIFEST_VERSION, type LexiconSiteManifest } from "./manifest.js";

export interface GenerateLexiconSiteOptions {
  astroRoot: string;
  /** Glob-relative or absolute paths to jsonld shards. */
  shardPaths: string[];
  outputDirRelative: string;
  localeId: string;
  title: string;
  pageSize: number;
  /**
   * When set, participates in the compile fingerprint (with integration
   * `starlightMdx.contentLexiconDirRelative`).
   */
  starlightContentLexiconDirRelative?: string;
}

export interface AlphaChunk {
  page: number;
  items: LexItem[];
}

export interface ByFieldChunkRow {
  fieldLabel: string;
  fieldUri: string;
  item: LexItem;
  showFieldHeading: boolean;
}

export interface ByFieldChunk {
  page: number;
  rows: ByFieldChunkRow[];
}

function sortAlpha(items: LexItem[]): LexItem[] {
  return [...items].sort((a, b) =>
    a.writtenForm.localeCompare(b.writtenForm, "en", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function paginate<T>(items: T[], pageSize: number): T[][] {
  if (pageSize <= 0) throw new Error("pageSize must be positive");
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages.length ? pages : [[]];
}

function annotateByFieldRows(
  flat: ByFieldFlatRow[],
  pageSize: number,
): ByFieldChunkRow[][] {
  const pages = paginate(flat, pageSize);
  const out: ByFieldChunkRow[][] = [];
  let prevTailFieldUri: string | null = null;

  for (let p = 0; p < pages.length; p++) {
    const slice = pages[p] ?? [];
    const rows: ByFieldChunkRow[] = slice.map((row, i) => {
      const showFieldHeading =
        i === 0
          ? prevTailFieldUri === null || row.fieldUri !== prevTailFieldUri
          : row.fieldUri !== (slice[i - 1]?.fieldUri ?? "");
      return {
        fieldLabel: row.fieldLabel,
        fieldUri: row.fieldUri,
        item: row.item,
        showFieldHeading,
      };
    });
    out.push(rows);
    const last = slice[slice.length - 1];
    prevTailFieldUri = last ? last.fieldUri : prevTailFieldUri;
  }

  return out;
}

export interface GenerateLexiconSiteResult {
  manifest: LexiconSiteManifest;
  /** True when shard inputs and options matched the last stamp; disk was not rewritten. */
  skipped: boolean;
}

export function generateLexiconSite(
  options: GenerateLexiconSiteOptions,
): GenerateLexiconSiteResult {
  const {
    astroRoot,
    shardPaths,
    outputDirRelative,
    localeId,
    title,
    pageSize,
    starlightContentLexiconDirRelative,
  } = options;

  const outAbs = path.resolve(astroRoot, outputDirRelative);
  mkdirSync(outAbs, { recursive: true });

  const fingerprint = computeLexiconInputFingerprint({
    astroRoot,
    shardPaths,
    localeId,
    title,
    pageSize,
    outputDirRelative,
    starlightContentLexiconDirRelative,
  });

  const manifestPath = path.join(outAbs, "manifest.json");
  const stampPath = path.join(outAbs, LEXICON_STAMP_FILENAME);

  if (existsSync(manifestPath)) {
    const stamp = readStampFile(stampPath);
    if (stamp?.fingerprint === fingerprint) {
      try {
        const cached = JSON.parse(
          readFileSync(manifestPath, "utf8"),
        ) as LexiconSiteManifest;
        if (cached.version === MANIFEST_VERSION) {
          return { manifest: cached, skipped: true };
        }
      } catch {
        /* regenerate */
      }
    }
  }

  const allItems: LexItem[] = [];
  for (const filePath of shardPaths.sort()) {
    const raw = readFileSync(filePath, "utf8");
    const doc = JSON.parse(raw) as Record<string, unknown>;
    allItems.push(...compileLexiconShard(filePath, doc));
  }

  const alphaSorted = sortAlpha(allItems);
  const alphaPages = paginate(alphaSorted, pageSize);

  const flatField = flattenByFieldRows(allItems);
  const byFieldPages = annotateByFieldRows(flatField, pageSize);

  const fieldMap = collectFieldsFromItems(allItems);
  const fieldLabelsOrdered = [...fieldMap.keys()].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );
  const fieldsMeta: Record<string, LexiconFieldMeta> = {};
  for (const label of fieldLabelsOrdered) {
    const m = fieldMap.get(label);
    if (m) fieldsMeta[label] = m;
  }

  alphaPages.forEach((items, idx) => {
    const chunk: AlphaChunk = { page: idx + 1, items };
    writeFileSync(
      path.join(outAbs, `alpha-${String(idx + 1).padStart(4, "0")}.json`),
      `${JSON.stringify(chunk, null, 0)}\n`,
    );
  });

  byFieldPages.forEach((rows, idx) => {
    const chunk: ByFieldChunk = { page: idx + 1, rows };
    writeFileSync(
      path.join(outAbs, `by-field-${String(idx + 1).padStart(4, "0")}.json`),
      `${JSON.stringify(chunk, null, 0)}\n`,
    );
  });

  const manifest: LexiconSiteManifest = {
    version: MANIFEST_VERSION,
    localeId,
    title,
    pageSize,
    outputDir: outputDirRelative.replace(/\\/g, "/"),
    fieldsMeta,
    fieldLabelsOrdered,
    alpha: {
      pageCount: Math.max(1, alphaPages.length),
      entryCount: alphaSorted.length,
    },
    byField: {
      pageCount: Math.max(1, byFieldPages.length),
      rowCount: flatField.length,
    },
  };

  writeFileSync(
    path.join(outAbs, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const stamp: LexiconStampFile = {
    fingerprint,
    compilerRevision: LEXICON_COMPILER_REVISION,
    manifestVersion: MANIFEST_VERSION,
  };
  writeFileSync(
    path.join(outAbs, LEXICON_STAMP_FILENAME),
    `${JSON.stringify(stamp, null, 2)}\n`,
  );

  return { manifest, skipped: false };
}
