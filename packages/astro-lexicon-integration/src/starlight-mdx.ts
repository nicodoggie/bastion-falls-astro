import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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

/**
 * Writes a single Starlight lexicon page at the route represented by
 * `contentLexiconDirRelative` and prunes the legacy generated subdirectory.
 * Skips disk writes when content is already identical so dev watchers (e.g.
 * Starlight’s docs loader) are not spammed with reloads.
 */
export function writeStarlightLexiconMdxPages(
  options: WriteStarlightLexiconMdxOptions,
): WriteStarlightLexiconMdxResult {
  const { astroRoot, manifest, contentLexiconDirRelative } = options;
  const publicBase = derivePublicLexiconBase(contentLexiconDirRelative);
  const lexAbs = path.resolve(astroRoot, contentLexiconDirRelative);
  const lexPageAbs = `${lexAbs}.mdx`;
  const genImport = `@/generated/lexicon/${manifest.localeId}`;

  let filesWritten = 0;

  const lexiconBody = `---
title: ${JSON.stringify(manifest.title)}
description: >-
  Search ${manifest.title} by word, definition, semantic field, or lexical type.
---

import LexiconSearchWorkbench from '@bastion-falls/lexicon-components/LexiconSearchWorkbench.astro';
import searchIndex from '${genImport}/search-index.json';

<LexiconSearchWorkbench
  searchIndex={searchIndex}
  lexiconUrl="${publicBase}"
/>
`;
  mkdirSync(path.dirname(lexPageAbs), { recursive: true });
  if (writeFileIfChanged(lexPageAbs, lexiconBody)) {
    filesWritten += 1;
  }

  if (existsSync(lexAbs)) {
    rmSync(lexAbs, { recursive: true, force: true });
  }

  return { filesWritten };
}
