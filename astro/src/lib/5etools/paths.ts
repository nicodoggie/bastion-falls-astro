import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root: .../bastion-falls-astro */
const repoRoot = path.resolve(thisDir, "../../../..");

/** Astro package root: .../bastion-falls-astro/astro */
const astroPackageRoot = path.resolve(thisDir, "../../..");

const dataDir = path.join(repoRoot, "5etools-src", "data");

export function getAstroPackageRoot(): string {
  return astroPackageRoot;
}

/** Starlight docs root: astro/src/content/docs */
export function getContentDocsDir(): string {
  return path.join(astroPackageRoot, "src", "content", "docs");
}

export function get5etoolsDataDir(): string {
  return dataDir;
}

export function assert5etoolsDataPresent(): void {
  if (!fs.existsSync(dataDir)) {
    throw new Error(
      `[5etools] Data directory missing: ${dataDir}. Run: git submodule update --init`,
    );
  }
}
