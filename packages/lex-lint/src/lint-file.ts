import { readFile } from "node:fs/promises";

import { parse } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";

import { defaultBaseIriFromLexicon } from "./base-iri.js";
import {
  enrichDiagnosticsWithLocations,
  offsetToLineColumn,
} from "./json-location.js";
import { lintGraphEntry } from "./lint-graph-entry.js";
import type { LintDiagnostic, LintOptions, LintReport, LexiconFileShape } from "./types.js";

function describeErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function lintLexiconDocument(
  doc: LexiconFileShape,
  filePath: string,
  options: Omit<LintOptions, "file">,
): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];

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
  if (!lex || typeof lex !== "object" || Array.isArray(lex)) {
    return [
      {
        severity: "error",
        code: "LEXICON_SHAPE",
        message: "Missing or invalid `lexicon` object.",
        file: filePath,
      },
    ];
  }

  const baseIri =
    options.baseIri ?? defaultBaseIriFromLexicon(doc, filePath);

  const entries = lex as Record<string, unknown>;
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

  return diagnostics;
}

/**
 * Lint a lexicon JSON file (`lexicon` map of entries with `graphEntry`).
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

  const diagnostics = enrichDiagnosticsWithLocations(
    await lintLexiconDocument(
      doc as LexiconFileShape,
      filePath,
      options,
    ),
    raw,
  );
  const ok = !diagnostics.some((d) => d.severity === "error");
  return { ok, diagnostics };
}
