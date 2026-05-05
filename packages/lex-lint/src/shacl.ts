import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { DatasetCore, Literal, Term } from "@rdfjs/types";
import N3 from "n3";
import SHACLValidator from "rdf-validate-shacl";
import type { ValidationResult } from "rdf-validate-shacl/src/validation-report.js";

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

/** Last URI fragment after `#` or `/`. */
function iriTail(iri: string): string {
  const hash = iri.lastIndexOf("#");
  const base = hash >= 0 ? iri.slice(hash + 1) : iri.slice(iri.lastIndexOf("/") + 1);
  return base || iri;
}

/** Readable RDF term for diagnostics (compact where helpful). */
function formatRdfTerm(term: Term | null | undefined): string {
  if (term == null) {
    return "?";
  }
  switch (term.termType) {
    case "NamedNode":
      return `<${term.value}>`;
    case "Literal": {
      const lit = term as Literal;
      if (lit.language && lit.language.length > 0) {
        return `${JSON.stringify(lit.value)}@${lit.language}`;
      }
      const dt = lit.datatype?.value;
      if (
        dt &&
        dt !== "http://www.w3.org/2001/XMLSchema#string" &&
        dt !== "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
      ) {
        return `${JSON.stringify(lit.value)}^^${iriTail(dt)}`;
      }
      return JSON.stringify(lit.value);
    }
    case "BlankNode":
      return "_:" + term.value;
    default:
      return termLabel(term);
  }
}

/** Stable SHACL diagnostic code from `sh:sourceConstraintComponent`. */
export function shaclViolationCode(component: Term | null | undefined): string {
  if (!component || component.termType !== "NamedNode") {
    return "SHACL_VIOLATION";
  }
  const tail = iriTail(component.value);
  const withoutSuffix = tail.replace(/ConstraintComponent$/u, "");
  const snake = withoutSuffix
    .replace(/([a-z\d])([A-Z])/gu, "$1_$2")
    .replace(/-/gu, "_")
    .toUpperCase();
  return `SHACL_${snake}`;
}

const MAX_DETAIL_DEPTH = 8;

function formatShaclViolationMessage(
  result: ValidationResult,
  depth = 0,
): string {
  const messages = (result.message ?? []).map(termLabel).filter(Boolean);
  const constraint = result.sourceConstraintComponent ?? undefined;
  const shape = result.sourceShape ?? undefined;
  const path = result.path ?? undefined;
  const focus = result.focusNode ?? undefined;
  const value = result.value ?? undefined;

  const metaParts: string[] = [];
  if (constraint?.termType === "NamedNode") {
    metaParts.push(`constraint ${iriTail(constraint.value)}`);
  } else if (constraint) {
    metaParts.push(`constraint ${formatRdfTerm(constraint)}`);
  }
  if (path) {
    metaParts.push(`path ${formatRdfTerm(path)}`);
  }
  if (focus) {
    metaParts.push(`focus ${formatRdfTerm(focus)}`);
  }
  if (shape && shape.termType === "NamedNode") {
    metaParts.push(`shape <${shape.value}>`);
  } else if (shape) {
    metaParts.push(`shape ${formatRdfTerm(shape)}`);
  }
  if (value) {
    metaParts.push(`value ${formatRdfTerm(value)}`);
  }

  let text =
    messages.length > 0 ? messages.join("; ") : "SHACL constraint violated.";
  if (metaParts.length > 0) {
    text += ` (${metaParts.join("; ")})`;
  }

  const prefix = depth > 0 ? `${"  ".repeat(depth)}└─ ` : "";
  const lines = [prefix + text];

  const details = result.detail ?? [];
  if (details.length > 0 && depth < MAX_DETAIL_DEPTH) {
    for (const child of details) {
      lines.push(formatShaclViolationMessage(child, depth + 1));
    }
  }

  return lines.join("\n");
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
    const msg = formatShaclViolationMessage(result);
    const code = shaclViolationCode(result.sourceConstraintComponent ?? undefined);

    const sevTerm = result.severity?.value ?? "";
    const severity =
      sevTerm.endsWith("Warning") || sevTerm.includes("#Warning")
        ? ("warning" as const)
        : ("error" as const);

    diagnostics.push({
      severity,
      code,
      message: msg,
      file: ctx.file,
      entryKey: ctx.entryKey,
    });
  }
  return diagnostics;
}
