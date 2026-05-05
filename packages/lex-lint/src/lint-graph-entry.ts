import jsonld from "jsonld";

import { createLexiconJsonLdContext } from "./jsonld-context.js";
import {
  lintWithShacl,
  loadBundledShapesDataset,
  loadShapesDataset,
  parseRdfDocument,
} from "./shacl.js";
import type { LintDiagnostic, LintOptions } from "./types.js";

const ONTOLEX_CF = "http://www.w3.org/ns/lemon/ontolex#canonicalForm";

function jsonBlobContains(value: unknown, needle: string): boolean {
  return JSON.stringify(value).includes(needle);
}

function describeErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function mergeGraphEntryDocument(
  graphEntry: Record<string, unknown>,
  baseIri: string,
  mergeContext: boolean,
): Record<string, unknown> {
  if (!mergeContext) {
    return {
      "@base": baseIri,
      ...graphEntry,
    };
  }

  return {
    "@context": createLexiconJsonLdContext(),
    "@base": baseIri,
    ...graphEntry,
  };
}

/**
 * Lint a single `graphEntry` JSON-LD fragment.
 */
export async function lintGraphEntry(
  entryKey: string,
  graphEntry: Record<string, unknown>,
  options: LintOptions = {},
): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  const mergeContext = options.mergeContext !== false;
  const baseIri =
    options.baseIri ??
    "https://w3id.org/lex-lint/lexicon/fallback/unset-base/";

  const merged = mergeGraphEntryDocument(graphEntry, baseIri, mergeContext);
  const inputHadCanonicalForm = Object.hasOwn(graphEntry, "canonicalForm");

  try {
    const expanded = await jsonld.expand(merged);

    if (
      !mergeContext &&
      inputHadCanonicalForm &&
      !jsonBlobContains(expanded, ONTOLEX_CF)
    ) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_MERGED_CONTEXT",
        message:
          "canonicalForm did not expand to ontolex:canonicalForm without " +
          "lex-lint @context merge.",
        file: options.file,
        entryKey,
      });
    }

    if (options.shacl === true && mergeContext) {
      let nquads: string;
      try {
        const rdfOut = await jsonld.toRDF(expanded, {
          format: "application/n-quads",
        });
        nquads = typeof rdfOut === "string" ? rdfOut : JSON.stringify(rdfOut);
      } catch (e) {
        diagnostics.push({
          severity: "error",
          code: "JSON_LD_TO_RDF_FAILED",
          message: describeErr(e),
          file: options.file,
          entryKey,
        });
        return diagnostics;
      }

      try {
        const dataDs = parseRdfDocument(nquads, "application/n-quads");
        const shapesDs =
          options.shaclShapesPath !== undefined
            ? await loadShapesDataset(options.shaclShapesPath)
            : loadBundledShapesDataset();

        diagnostics.push(
          ...(await lintWithShacl(dataDs, shapesDs, {
            file: options.file,
            entryKey,
          })),
        );
      } catch (e) {
        diagnostics.push({
          severity: "error",
          code: "SHACL_SETUP_FAILED",
          message: describeErr(e),
          file: options.file,
          entryKey,
        });
      }
    }
  } catch (e) {
    diagnostics.push({
      severity: "error",
      code: "JSON_LD_EXPAND_FAILED",
      message: describeErr(e),
      file: options.file,
      entryKey,
    });
  }

  return diagnostics;
}
