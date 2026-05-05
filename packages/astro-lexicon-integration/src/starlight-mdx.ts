import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { LexiconSiteManifest } from "./manifest.js";

export const CONTENT_DOCS_PREFIX = "src/content/docs" as const;

/** Starlight doc URL for a path under `src/content/docs/world/.../lexicon`. */
export function derivePublicLexiconBase(contentLexiconDirRelative: string): string {
  const norm = contentLexiconDirRelative.replace(/\\/g, "/").replace(/^\/+/, "");
  const prefix = `${CONTENT_DOCS_PREFIX}/`;
  if (!norm.startsWith(prefix)) {
    throw new Error(
      `starlightMdx.contentLexiconDirRelative must start with ${prefix} (got ${norm})`,
    );
  }
  return `/${norm.slice(prefix.length)}`;
}

export interface WriteStarlightLexiconMdxOptions {
  astroRoot: string;
  manifest: LexiconSiteManifest;
  /** e.g. `src/content/docs/world/.../early-hick/lexicon` */
  contentLexiconDirRelative: string;
}

export interface WriteStarlightLexiconMdxResult {
  /** How many `.mdx` files were actually written (content differed or missing). */
  filesWritten: number;
}

function writeFileIfChanged(absPath: string, next: string): boolean {
  if (existsSync(absPath)) {
    try {
      if (readFileSync(absPath, "utf8") === next) {
        return false;
      }
    } catch {
      /* write below */
    }
  }
  writeFileSync(absPath, next);
  return true;
}

function pruneNumberedMdxPages(dir: string, maxPage: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const m = /^(\d+)\.mdx$/.exec(name);
    if (m && Number(m[1]) > maxPage) {
      unlinkSync(path.join(dir, name));
    }
  }
}

/**
 * Writes `lexicon/alpha/{1..N}.mdx` and `lexicon/by-field/{1..N}.mdx` for Starlight.
 * Skips disk writes when content is already identical so dev watchers (e.g.
 * Starlight’s docs loader) are not spammed with reloads.
 */
export function writeStarlightLexiconMdxPages(
  options: WriteStarlightLexiconMdxOptions,
): WriteStarlightLexiconMdxResult {
  const { astroRoot, manifest, contentLexiconDirRelative } = options;
  const publicBase = derivePublicLexiconBase(contentLexiconDirRelative);
  const lexAbs = path.resolve(astroRoot, contentLexiconDirRelative);
  const genImport = `@/generated/lexicon/${manifest.localeId}`;

  const alphaDir = path.join(lexAbs, "alpha");
  const byFieldDir = path.join(lexAbs, "by-field");
  mkdirSync(alphaDir, { recursive: true });
  mkdirSync(byFieldDir, { recursive: true });

  pruneNumberedMdxPages(alphaDir, manifest.alpha.pageCount);
  pruneNumberedMdxPages(byFieldDir, manifest.byField.pageCount);

  let filesWritten = 0;

  for (let i = 1; i <= manifest.alpha.pageCount; i++) {
    const pad = String(i).padStart(4, "0");
    const title = `${manifest.title} — alphabetical (page ${i} of ${manifest.alpha.pageCount})`;
    const body = `---
title: ${JSON.stringify(title)}
description: >-
  ${manifest.title}, sorted alphabetically (page ${i} of ${manifest.alpha.pageCount}).
---

import LexiconAlphaPage from '@bastion-falls/lexicon-components/LexiconAlphaPage.astro';
import chunk from '${genImport}/alpha-${pad}.json';

<LexiconAlphaPage
  items={chunk.items}
  basePath="${publicBase}/alpha"
  page={${String(i)}}
  pageCount={${String(manifest.alpha.pageCount)}}
/>
`;
    if (writeFileIfChanged(path.join(alphaDir, `${i}.mdx`), body)) {
      filesWritten += 1;
    }
  }

  const indexFieldUris = manifest.fieldLabelsOrdered.map(
    (label) => manifest.fieldsMeta[label]?.uri ?? "",
  );
  const indexFieldLabels = manifest.fieldLabelsOrdered.map(
    (label) => manifest.fieldsMeta[label]?.label ?? label,
  );

  for (let i = 1; i <= manifest.byField.pageCount; i++) {
    const pad = String(i).padStart(4, "0");
    const title = `${manifest.title} — by semantic field (page ${i} of ${manifest.byField.pageCount})`;
    const showIndex = i === 1;
    const body = `---
title: ${JSON.stringify(title)}
description: >-
  ${manifest.title}, grouped by semantic field (page ${i} of ${manifest.byField.pageCount}).
---

import LexiconByFieldPage from '@bastion-falls/lexicon-components/LexiconByFieldPage.astro';
import chunk from '${genImport}/by-field-${pad}.json';

<LexiconByFieldPage
  rows={chunk.rows}
  basePath="${publicBase}/by-field"
  page={${String(i)}}
  pageCount={${String(manifest.byField.pageCount)}}
  showFieldIndex={${showIndex ? "true" : "false"}}
  indexFieldUris={${JSON.stringify(indexFieldUris)}}
  indexFieldLabels={${JSON.stringify(indexFieldLabels)}}
/>
`;
    if (writeFileIfChanged(path.join(byFieldDir, `${i}.mdx`), body)) {
      filesWritten += 1;
    }
  }

  return { filesWritten };
}
