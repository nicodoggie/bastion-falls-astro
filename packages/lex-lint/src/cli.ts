#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import type { LintDiagnostic } from "./types.js";
import { lintGlobPatterns } from "./run-glob.js";

/** Prefer repo-relative paths so terminal links resolve from the workspace root. */
function workspaceDisplayPath(filePath: string): string {
  const abs = path.resolve(filePath);
  const rel = path.relative(process.cwd(), abs);
  if (rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== "..") {
    return rel;
  }
  return abs;
}

function diagnosticLocationPrefix(d: LintDiagnostic): string {
  const fp = d.file ? workspaceDisplayPath(d.file) : "";
  if (fp !== "" && d.line !== undefined && d.column !== undefined) {
    return `${fp}:${d.line}:${d.column}`;
  }
  if (fp !== "" && d.entryKey !== undefined && d.entryKey !== "") {
    return `${fp}#${d.entryKey}`;
  }
  return fp !== "" ? fp : "<unknown>";
}

function printUsage(out: typeof process.stderr): void {
  out.write(`Usage: lex-lint [--base <iri>] [--shacl] <glob|file...>\n`);
  out.write(`  Validates lexicon JSON: merges JSON-LD @context per graphEntry.\n`);
  out.write(`  --base   Override default base IRI for relative @id values.\n`);
  out.write(`  --shacl  Run bundled minimal OntoLex SHACL shapes.\n`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: "string" },
      shacl: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help === true) {
    printUsage(process.stderr);
    process.exit(0);
    return;
  }

  if (positionals.length === 0) {
    printUsage(process.stderr);
    process.exit(1);
    return;
  }

  const report = await lintGlobPatterns(positionals, {
    baseIri: values.base,
    shacl: values.shacl === true,
  });

  for (const d of report.diagnostics) {
    const loc = diagnosticLocationPrefix(d);
    process.stderr.write(`${loc}: [${d.severity}] ${d.code}: ${d.message}\n`);
  }

  process.exit(report.ok ? 0 : 1);
}

await main();
