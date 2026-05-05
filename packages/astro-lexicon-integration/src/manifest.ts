import type { LexiconFieldMeta } from "@bastion-falls/types";

export const MANIFEST_VERSION = 1 as const;

export interface LexiconSiteManifest {
  version: typeof MANIFEST_VERSION;
  localeId: string;
  title: string;
  pageSize: number;
  /** Relative to Astro project root (e.g. src/generated/lexicon/early-hick). */
  outputDir: string;
  fieldsMeta: Record<string, LexiconFieldMeta>;
  /** Sorted field labels for TOC order. */
  fieldLabelsOrdered: string[];
  alpha: {
    pageCount: number;
    entryCount: number;
  };
  byField: {
    pageCount: number;
    rowCount: number;
  };
}
