import { globSync } from "glob";

import { lintLexiconFile } from "./lint-file.js";
import type { LintDiagnostic, LintOptions, LintReport } from "./types.js";

/**
 * Expand globs and lint each lexicon JSON file.
 */
export async function lintGlobPatterns(
  patterns: string[],
  options: Omit<LintOptions, "file"> = {},
): Promise<LintReport> {
  const paths = [
    ...new Set(patterns.flatMap((p) => globSync(p, { nodir: true }))),
  ].sort();

  const diagnostics: LintDiagnostic[] = [];
  for (const file of paths) {
    const r = await lintLexiconFile(file, options);
    diagnostics.push(...r.diagnostics);
  }

  const ok = !diagnostics.some((d) => d.severity === "error");
  return { ok, diagnostics };
}
