#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  CONFIG_FILENAME,
  defaultLexLintConfig,
  findLexLintConfigPath,
  loadLexLintConfigFile,
  mergeConfigWithCli,
} from "./config.js";
import { runFixPipeline } from "./fix-pipeline.js";
import type { LintDiagnostic } from "./types.js";
import { expandLintPatterns, lintGlobPatterns } from "./run-glob.js";

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
  out.write(`Usage: lex-lint [options] [glob|file...]\n`);
  out.write(`  Without files: uses files.include from ${CONFIG_FILENAME} (if present).\n`);
  out.write(`\n`);
  out.write(`Options:\n`);
  out.write(`  --config <path>   Config file (default: search cwd upward for ${CONFIG_FILENAME})\n`);
  out.write(`  --base <iri>      Override default base IRI for relative @id values.\n`);
  out.write(`  --shacl           Run bundled minimal OntoLex SHACL shapes.\n`);
  out.write(`  --fix             Apply autofixes (jsonld/duplicate-graph-id merge) then verify.\n`);
  out.write(`  --fix-dry-run     Report autofix targets without writing files.\n`);
  out.write(`  -h, --help        Show help.\n`);
  out.write(`\n`);
  out.write(`See packages/lex-lint/AGENTS.md for architecture and adding rules.\n`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: "string" },
      shacl: { type: "boolean" },
      config: { type: "string" },
      fix: { type: "boolean", default: false },
      fixDryRun: { type: "boolean", default: false },
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

  let merged = defaultLexLintConfig();
  try {
    if (values.config !== undefined) {
      merged = loadLexLintConfigFile(values.config);
    } else {
      const found = findLexLintConfigPath(process.cwd());
      if (found) {
        merged = loadLexLintConfigFile(found);
      }
    }
  } catch (e) {
    process.stderr.write(
      `${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
    return;
  }

  merged = mergeConfigWithCli(merged, {
    base: values.base,
    shacl: values.shacl,
  });

  const patterns =
    positionals.length > 0 ? positionals : merged.files.include;

  if (patterns.length === 0) {
    printUsage(process.stderr);
    process.stderr.write(
      `\nError: pass at least one file/glob or set files.include in ${CONFIG_FILENAME}.\n`,
    );
    process.exit(1);
    return;
  }

  const paths = expandLintPatterns(patterns, merged.files.exclude);

  const lintOpts = {
    baseIri: merged.baseIri,
    shacl: merged.shacl,
    ruleSettings: merged.rules,
  };

  const doFix = values.fix === true || values.fixDryRun === true;
  const report = doFix
    ? await runFixPipeline(paths, {
        ...lintOpts,
        dryRun: values.fixDryRun === true,
      })
    : await lintGlobPatterns(patterns, lintOpts, {
        exclude: merged.files.exclude,
      });

  if ("dryRunNotes" in report && Array.isArray(report.dryRunNotes)) {
    for (const line of report.dryRunNotes) {
      process.stderr.write(`${line}\n`);
    }
  }

  for (const d of report.diagnostics) {
    const loc = diagnosticLocationPrefix(d);
    process.stderr.write(`${loc}: [${d.severity}] ${d.code}: ${d.message}\n`);
  }

  process.exit(report.ok ? 0 : 1);
}

await main();
