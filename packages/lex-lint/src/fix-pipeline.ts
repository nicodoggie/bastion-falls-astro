import { readFile, writeFile } from "node:fs/promises";

import { parse } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";

import {
  enrichDiagnosticsWithLocations,
  offsetToLineColumn,
} from "./json-location.js";
import { stringifyLexiconDoc } from "./rules/implementations/jsonld-duplicate-graph-id.js";
import { RULE_MODULES } from "./rules/registry.js";
import { lintLexiconParsed } from "./lint-file.js";
import type { LintDiagnostic, LintOptions, LintReport } from "./types.js";

export type FixPipelineOptions = Omit<LintOptions, "file"> & {
  dryRun: boolean;
};

export async function runFixPipeline(
  paths: string[],
  options: FixPipelineOptions,
): Promise<LintReport & { dryRunNotes?: string[] }> {
  const diagnostics: LintDiagnostic[] = [];
  const dryRunNotes: string[] = [];

  for (const filePath of paths) {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (e) {
      diagnostics.push({
        severity: "error",
        code: "FILE_READ_FAILED",
        message: e instanceof Error ? e.message : String(e),
        file: filePath,
      });
      continue;
    }

    let doc: unknown;
    try {
      doc = JSON.parse(raw) as unknown;
    } catch (e) {
      const errors: ParseError[] = [];
      parse(raw, errors, { disallowComments: true });
      const off = errors[0]?.offset ?? 0;
      const pos = offsetToLineColumn(raw, off);
      diagnostics.push({
        severity: "error",
        code: "JSON_PARSE_FAILED",
        message: e instanceof Error ? e.message : String(e),
        file: filePath,
        line: pos.line,
        column: pos.column,
      });
      continue;
    }

    const fixCtx = {
      filePath,
      ruleSettings: options.ruleSettings ?? {},
      dryRun: options.dryRun,
    };

    const fixDiagnosticsWithFile: LintDiagnostic[] = [];
    let fixOk = true;
    for (const mod of RULE_MODULES) {
      if (!mod.fix) {
        continue;
      }
      const res = mod.fix(doc, fixCtx);
      doc = res.doc;
      if (res.diagnostics) {
        for (const d of res.diagnostics) {
          fixDiagnosticsWithFile.push({ ...d, file: filePath });
        }
      }
      if (!res.ok) {
        fixOk = false;
        break;
      }
    }

    diagnostics.push(
      ...enrichDiagnosticsWithLocations(fixDiagnosticsWithFile, raw),
    );

    if (!fixOk) {
      continue;
    }

    const newRaw = stringifyLexiconDoc(doc);
    const verifyDoc = JSON.parse(newRaw) as unknown;
    const verify = await lintLexiconParsed(verifyDoc, newRaw, filePath, options);
    diagnostics.push(...verify.diagnostics);
    if (!verify.ok) {
      continue;
    }

    if (options.dryRun) {
      dryRunNotes.push(`would write: ${filePath}`);
    } else {
      await writeFile(filePath, newRaw, "utf8");
    }
  }

  const ok = !diagnostics.some((d) => d.severity === "error");
  return {
    ok,
    diagnostics,
    ...(options.dryRun ? { dryRunNotes } : {}),
  };
}
