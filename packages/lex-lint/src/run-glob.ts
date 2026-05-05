import { globSync } from "glob";

import { lintLexiconFile } from "./lint-file.js";
import type { LintDiagnostic, LintOptions, LintReport } from "./types.js";

export type GlobExpansionOptions = {
  exclude?: string[];
};

export function expandLintPatterns(
  patterns: string[],
  exclude: string[] = [],
): string[] {
  const paths = new Set<string>();
  for (const p of patterns) {
    for (const f of globSync(p, { nodir: true, ignore: exclude })) {
      paths.add(f);
    }
  }
  return [...paths].sort();
}

/**
 * Expand globs and lint each lexicon JSON file.
 */
export async function lintGlobPatterns(
  patterns: string[],
  options: Omit<LintOptions, "file"> = {},
  globOpts: GlobExpansionOptions = {},
): Promise<LintReport> {
  const exclude = globOpts.exclude ?? [];
  const paths = expandLintPatterns(patterns, exclude);

  const diagnostics: LintDiagnostic[] = [];
  for (const file of paths) {
    const r = await lintLexiconFile(file, options);
    diagnostics.push(...r.diagnostics);
  }

  const ok = !diagnostics.some((d) => d.severity === "error");
  return { ok, diagnostics, filesScanned: paths.length };
}
