import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { DatasetCore } from "@rdfjs/types";
import N3 from "n3";
import SHACLValidator from "rdf-validate-shacl";

import { rdfEnv } from "./rdf-env.js";
import type { LintDiagnostic } from "./types.js";

export function parseRdfDocument(content: string, mediaType: string): DatasetCore {
  const ds = rdfEnv.dataset();
  const parser =
    mediaType === "application/n-quads"
      ? new N3.Parser({ format: "application/n-quads" })
      : new N3.Parser();
  const quads = parser.parse(content);
  for (const quad of quads) {
    ds.add(quad);
  }
  return ds;
}

/** Bundled shapes next to compiled `dist/` → `../shapes`. */
export function loadBundledShapesDataset(): DatasetCore {
  const url = new URL("../shapes/lexicon-core.ttl", import.meta.url);
  const ttl = readFileSync(fileURLToPath(url), "utf8");
  return parseRdfDocument(ttl, "text/turtle");
}

export async function loadShapesDataset(path: string): Promise<DatasetCore> {
  const ttl = await readFile(path, "utf8");
  return parseRdfDocument(ttl, "text/turtle");
}

function termLabel(term: unknown): string {
  if (term && typeof term === "object" && "value" in term) {
    return String((term as { value: string }).value);
  }
  return String(term);
}

export async function lintWithShacl(
  data: DatasetCore,
  shapes: DatasetCore,
  ctx: { file?: string; entryKey?: string },
): Promise<LintDiagnostic[]> {
  const validator = new SHACLValidator(shapes, { factory: rdfEnv });
  const report = await validator.validate(data);
  if (report.conforms) {
    return [];
  }

  const diagnostics: LintDiagnostic[] = [];
  for (const result of report.results) {
    const messages = result.message.map(termLabel).filter(Boolean);
    const msg =
      messages.length > 0
        ? messages.join("; ")
        : `SHACL violation at focus ${termLabel(result.focusNode)} path ${termLabel(result.path)}`;

    const sevTerm = result.severity?.value ?? "";
    const severity =
      sevTerm.endsWith("Warning") || sevTerm.includes("#Warning")
        ? ("warning" as const)
        : ("error" as const);

    diagnostics.push({
      severity,
      code: "SHACL_VIOLATION",
      message: msg,
      file: ctx.file,
      entryKey: ctx.entryKey,
    });
  }
  return diagnostics;
}
