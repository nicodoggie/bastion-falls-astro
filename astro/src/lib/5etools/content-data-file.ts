import fs from "node:fs";
import path from "node:path";

import { load as yamlLoad } from "js-yaml";

export function readContentDataFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") return JSON.parse(raw) as unknown;
  if (ext === ".yaml" || ext === ".yml") return yamlLoad(raw) as unknown;

  throw new Error(`Unsupported content data file extension: ${ext}`);
}

export function resolveContentDataFilePath(
  relativeToContentDocs: string,
  contentDocsDir: string,
): string | null {
  const raw = relativeToContentDocs.trim().replace(/^[/\\]+/, "");
  if (!raw || raw.includes("\0")) return null;

  const base = path.resolve(contentDocsDir);
  const abs = path.normalize(path.resolve(base, raw));
  const relToBase = path.relative(base, abs);
  if (relToBase.startsWith("..") || path.isAbsolute(relToBase)) return null;
  return abs;
}
