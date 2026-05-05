import { readFile } from "node:fs/promises";

import { parse } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";

import { defaultBaseIriFromLexicon } from "./base-iri.js";
import {
  enrichDiagnosticsWithLocations,
  offsetToLineColumn,
} from "./json-location.js";
import { isJsonLdGraphLexicon, isLexiconWrapper } from "./detect-format.js";
import { lintGraphEntry } from "./lint-graph-entry.js";
import { lintJsonLdGraphDocument } from "./lint-jsonld-graph.js";
import { applyRuleSeverities } from "./rules/apply-severities.js";
import {
  collectRegistryLexiconWrapperDiagnostics,
} from "./rules/registry.js";
import type { LintContext } from "./rules/types.js";
import type {
  LintDiagnostic,
  LintOptions,
  LintReport,
  LexiconFileShape,
} from "./types.js";

function describeErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function lintLexiconDocument(
  doc: LexiconFileShape & { lexicon: Record<string, unknown> },
  filePath: string,
  options: Omit<LintOptions, "file">,
): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];

  const ctx: LintContext = {
    filePath,
    ruleSettings: options.ruleSettings ?? {},
  };

  if (!doc || typeof doc !== "object") {
    return [
      {
        severity: "error",
        code: "LEXICON_SHAPE",
        message: "Lexicon root must be an object.",
        file: filePath,
      },
    ];
  }

  const lex = doc.lexicon;
  const entries = lex;

  const baseIri =
    options.baseIri ?? defaultBaseIriFromLexicon(doc, filePath);

  for (const [entryKey, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      diagnostics.push({
        severity: "error",
        code: "LEXICON_ENTRY_SHAPE",
        message: `Entry "${entryKey}" must be an object.`,
        file: filePath,
        entryKey,
      });
      continue;
    }

    const graphEntry = (entry as Record<string, unknown>).graphEntry;
    if (
      !graphEntry ||
      typeof graphEntry !== "object" ||
      Array.isArray(graphEntry)
    ) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_GRAPH_ENTRY",
        message: `Entry "${entryKey}" is missing an object graphEntry.`,
        file: filePath,
        entryKey,
      });
      continue;
    }

    diagnostics.push(
      ...(await lintGraphEntry(entryKey, graphEntry as Record<string, unknown>, {
        ...options,
        baseIri,
        file: filePath,
      })),
    );
  }

  diagnostics.push(
    ...collectRegistryLexiconWrapperDiagnostics(
      doc as Record<string, unknown> & { lexicon: Record<string, unknown> },
      ctx,
    ),
  );

  return diagnostics;
}

/**
 * Lint an already-parsed lexicon document (JSON string used only for locations).
 */
export async function lintLexiconParsed(
  doc: unknown,
  raw: string,
  filePath: string,
  options: Omit<LintOptions, "file"> = {},
): Promise<LintReport> {
  let rawDiagnostics: LintDiagnostic[];
  if (isLexiconWrapper(doc)) {
    rawDiagnostics = await lintLexiconDocument(
      doc as LexiconFileShape & { lexicon: Record<string, unknown> },
      filePath,
      options,
    );
  } else if (isJsonLdGraphLexicon(doc)) {
    rawDiagnostics = await lintJsonLdGraphDocument(
      doc as Record<string, unknown>,
      filePath,
      options,
    );
  } else {
    rawDiagnostics = [
      {
        severity: "error",
        code: "LEXICON_SHAPE",
        message:
          "Expected a content lexicon wrapper with a `lexicon` object, or " +
          "JSON-LD with `@context` and `@graph` (e.g. `.jsonld` under assets).",
        file: filePath,
      },
    ];
  }

  rawDiagnostics = applyRuleSeverities(
    rawDiagnostics,
    options.ruleSettings ?? {},
  );
  const diagnostics = enrichDiagnosticsWithLocations(rawDiagnostics, raw);
  const ok = !diagnostics.some((d) => d.severity === "error");
  return { ok, diagnostics };
}

/**
 * Lint a lexicon source file: either the content-wrapper shape (`lexicon` map +
 * `graphEntry`) or standalone JSON-LD (`@context` + `@graph`).
 */
export async function lintLexiconFile(
  filePath: string,
  options: Omit<LintOptions, "file"> = {},
): Promise<LintReport> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "FILE_READ_FAILED",
          message: describeErr(e),
          file: filePath,
        },
      ],
    };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw) as unknown;
  } catch (e) {
    const errors: ParseError[] = [];
    parse(raw, errors, { disallowComments: true });
    const off = errors[0]?.offset ?? 0;
    const pos = offsetToLineColumn(raw, off);
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "JSON_PARSE_FAILED",
          message: describeErr(e),
          file: filePath,
          line: pos.line,
          column: pos.column,
        },
      ],
    };
  }

  return lintLexiconParsed(doc, raw, filePath, options);
}
