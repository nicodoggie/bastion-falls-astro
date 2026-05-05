import { defaultBaseIriFromLexicon } from "./base-iri.js";
import { lintGraphEntry } from "./lint-graph-entry.js";
import type { LintDiagnostic, LintOptions } from "./types.js";

/**
 * Lint a JSON-LD document with `@context` and `@graph` (standalone assets, not
 * the MDX-era `lexicon` wrapper map).
 */
export async function lintJsonLdGraphDocument(
  doc: Record<string, unknown>,
  filePath: string,
  options: Omit<LintOptions, "file" | "jsonLdDocumentContext">,
): Promise<LintDiagnostic[]> {
  const ctx = doc["@context"];
  if (ctx === null || ctx === undefined || typeof ctx !== "object") {
    return [
      {
        severity: "error",
        code: "JSON_LD_CONTEXT_SHAPE",
        message:
          "JSON-LD lexicon files must include a JSON object or array `@context`.",
        file: filePath,
      },
    ];
  }

  const graph = doc["@graph"] as unknown;
  const diagnostics: LintDiagnostic[] = [];

  if (!Array.isArray(graph)) {
    diagnostics.push({
      severity: "error",
      code: "JSON_LD_GRAPH_SHAPE",
      message: "`@graph` must be an array of JSON-LD nodes.",
      file: filePath,
    });
    return diagnostics;
  }

  const baseIri =
    options.baseIri ??
    defaultBaseIriFromLexicon(
      {
        id: typeof doc["@id"] === "string" ? doc["@id"] : undefined,
      },
      filePath,
    );

  let idx = 0;
  for (const node of graph) {
    const entryKey = `@graph[${idx}]`;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      diagnostics.push({
        severity: "error",
        code: "GRAPH_NODE_SHAPE",
        message: `@graph[${idx}] must be a JSON object.`,
        file: filePath,
        entryKey,
      });
      idx++;
      continue;
    }

    diagnostics.push(
      ...(await lintGraphEntry(entryKey, node as Record<string, unknown>, {
        ...options,
        baseIri,
        file: filePath,
        jsonLdDocumentContext: ctx,
      })),
    );
    idx++;
  }

  return diagnostics;
}
