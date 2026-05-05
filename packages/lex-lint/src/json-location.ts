import { findNodeAtLocation, parseTree } from "jsonc-parser";

import type { LintDiagnostic } from "./types.js";

/** 1-based line and column (VS Code / Cursor terminal link style). */
export function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  let i = 0;
  const end = Math.min(Math.max(0, offset), text.length);
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === 13 /* \r */ && text.charCodeAt(i + 1) === 10 /* \n */) {
      line++;
      column = 1;
      i += 2;
      continue;
    }
    if (c === 10 /* \n */ || c === 13 /* \r */) {
      line++;
      column = 1;
      i++;
      continue;
    }
    column++;
    i++;
  }
  return { line, column };
}

export function locationAtJsonPath(
  sourceText: string,
  jsonPath: (string | number)[],
): { line: number; column: number } | undefined {
  const root = parseTree(sourceText, undefined, {
    disallowComments: true,
  });
  if (!root) return undefined;
  const node = findNodeAtLocation(root, jsonPath);
  if (!node) return undefined;
  return offsetToLineColumn(sourceText, node.offset);
}

export function enrichDiagnosticsWithLocations(
  diagnostics: LintDiagnostic[],
  sourceText: string,
): LintDiagnostic[] {
  return diagnostics.map((d) => enrichDiagnostic(d, sourceText));
}

function enrichDiagnostic(
  d: LintDiagnostic,
  sourceText: string,
): LintDiagnostic {
  if (d.line !== undefined || d.code === "FILE_READ_FAILED") {
    return { ...d };
  }

  let loc: { line: number; column: number } | undefined;

  if (d.code === "LEXICON_SHAPE") {
    loc = { line: 1, column: 1 };
  } else if (
    d.code === "JSON_LD_CONTEXT_SHAPE" ||
    d.code === "JSON_LD_GRAPH_SHAPE"
  ) {
    loc = { line: 1, column: 1 };
  } else if (d.entryKey) {
    const graphIdx = /^@graph\[(\d+)\]$/.exec(d.entryKey);
    if (graphIdx) {
      loc = locationAtJsonPath(sourceText, [
        "@graph",
        Number(graphIdx[1]),
      ]);
    } else if (
      d.code === "LEXICON_ENTRY_SHAPE" ||
      d.code === "MISSING_GRAPH_ENTRY"
    ) {
      loc = locationAtJsonPath(sourceText, ["lexicon", d.entryKey]);
    } else {
      loc = locationAtJsonPath(sourceText, [
        "lexicon",
        d.entryKey,
        "graphEntry",
      ]);
    }
  }

  if (!loc) return { ...d };
  return { ...d, line: loc.line, column: loc.column };
}
