import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { MANIFEST_VERSION } from "./manifest.js";

/**
 * Bump when JSON-LD → LexItem mapping, chunk layout, or pagination logic changes
 * so stale output is not reused.
 */
export const LEXICON_COMPILER_REVISION = 4;

export interface LexiconStampFile {
  fingerprint: string;
  compilerRevision: number;
  manifestVersion: typeof MANIFEST_VERSION;
}

export function computeLexiconInputFingerprint(options: {
  astroRoot: string;
  shardPaths: string[];
  localeId: string;
  title: string;
  pageSize: number;
  outputDirRelative: string;
  /** Included so changing Starlight MDX layout path invalidates cache. */
  starlightContentLexiconDirRelative?: string;
  audioManifestPathRelative?: string;
  audioPublicBaseUrl?: string;
}): string {
  const {
    astroRoot,
    shardPaths,
    localeId,
    title,
    pageSize,
    outputDirRelative,
    starlightContentLexiconDirRelative,
    audioManifestPathRelative,
    audioPublicBaseUrl,
  } = options;

  const normalizedRoot = path.resolve(astroRoot);
  const lines: string[] = [];

  for (const abs of [...shardPaths].sort()) {
    const resolved = path.resolve(abs);
    if (!existsSync(resolved)) {
      lines.push(`missing\t${resolved}`);
      continue;
    }
    const st = statSync(resolved);
    const rel = path.relative(normalizedRoot, resolved).replace(/\\/g, "/");
    lines.push(`${rel}\t${st.mtimeMs}\t${st.size}`);
  }

  if (audioManifestPathRelative) {
    const resolved = path.resolve(normalizedRoot, audioManifestPathRelative);
    if (!existsSync(resolved)) {
      lines.push(`missing-audio-manifest\t${audioManifestPathRelative.replace(/\\/g, "/")}`);
    } else {
      const st = statSync(resolved);
      const rel = path.relative(normalizedRoot, resolved).replace(/\\/g, "/");
      lines.push(`audio-manifest\t${rel}\t${st.mtimeMs}\t${st.size}`);
    }
  }

  const payload = [
    lines.join("\n"),
    "",
    `localeId=${localeId}`,
    `title=${title}`,
    `pageSize=${pageSize}`,
    `outputDir=${outputDirRelative.replace(/\\/g, "/")}`,
    `starlightMDX=${starlightContentLexiconDirRelative?.replace(/\\/g, "/") ?? ""}`,
    `audioManifest=${audioManifestPathRelative?.replace(/\\/g, "/") ?? ""}`,
    `audioPublicBase=${audioPublicBaseUrl ?? ""}`,
    `manifestVersion=${MANIFEST_VERSION}`,
    `compilerRevision=${LEXICON_COMPILER_REVISION}`,
  ].join("\n");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export const LEXICON_STAMP_FILENAME = ".lexicon-input-stamp.json" as const;

export function readStampFile(stampPath: string): LexiconStampFile | null {
  try {
    if (!existsSync(stampPath)) return null;
    const raw = JSON.parse(readFileSync(stampPath, "utf8")) as LexiconStampFile;
    if (
      typeof raw.fingerprint === "string" &&
      typeof raw.compilerRevision === "number" &&
      raw.manifestVersion === MANIFEST_VERSION &&
      raw.compilerRevision === LEXICON_COMPILER_REVISION
    ) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}
