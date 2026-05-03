#!/usr/bin/env node
/**
 * Disposable: rewrite Starlight /world/... doc URLs in markdown/mdx to
 * repository-relative paths from each file, so links match on-disk sources.
 *
 * Resolves /world/<slug> to astro/src/content/docs/world/<slug>.mdx,
 * .md, or <slug>/index.mdx|md (first match). Skips non-world absolute
 * URLs, mailto, and http(s). Preserves #hash and ?query on the new URL.
 *
 * Usage (from repo root or astro/):
 *   node astro/migration-scripts/world-astro-urls-to-relative.mjs --dry-run
 *   node astro/migration-scripts/world-astro-urls-to-relative.mjs --write
 *   node ... --report path/to/report.json   # JSON summary (with --dry-run or --write)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(__dirname, "../src/content/docs/world");

const MD_LINK_RE = /\[([^\]]*)\]\((\/world[^)\s]+)\)/g;

function parseArgs() {
  const write = process.argv.includes("--write");
  const dryRun = process.argv.includes("--dry-run") || !write;
  const reportIdx = process.argv.indexOf("--report");
  const reportPath =
    reportIdx !== -1 && process.argv[reportIdx + 1]
      ? path.resolve(process.argv[reportIdx + 1])
      : null;
  return { write, dryRun, reportPath };
}

/**
 * @param {string} rawPath /world/... with optional trailing slash, ?q, #h
 * @returns {{ slug: string, suffix: string } | null}
 */
function parseWorldPath(rawPath) {
  if (!rawPath.startsWith("/world")) return null;
  // Reject "/world-novelty/..." etc.; only "/world", "/world/", "/world?foo".
  if (
    rawPath.length > "/world".length &&
    rawPath.codePointAt("/world".length) !== 0x2f &&
    rawPath.codePointAt("/world".length) !== 0x3f &&
    rawPath.codePointAt("/world".length) !== 0x23
  ) {
    return null;
  }
  let rest = rawPath.slice("/world".length);
  if (rest.startsWith("/")) rest = rest.slice(1);
  const q = rest.indexOf("?");
  const h = rest.indexOf("#");
  let cut = rest.length;
  if (q !== -1) cut = Math.min(cut, q);
  if (h !== -1) cut = Math.min(cut, h);
  let pathPart = rest.slice(0, cut);
  const suffix = rest.slice(cut);
  pathPart = pathPart.replace(/\/+$/, "");
  if (pathPart.split("/").some((p) => p === ".." || p === ".")) {
    return null;
  }
  return { slug: pathPart, suffix };
}

/**
 * @param {string} slugPath e.g. "families/maidenfeld"
 * @returns {string | null} absolute path to an existing file
 */
function resolveSlugToFile(slugPath) {
  if (slugPath === "" || slugPath === "/") {
    for (const name of ["index.mdx", "index.md"]) {
      const p = path.join(WORLD_ROOT, name);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  const parts = slugPath.split("/").filter(Boolean);
  const base = path.join(WORLD_ROOT, ...parts);
  const candidates = [
    base + ".mdx",
    base + ".md",
    path.join(base, "index.mdx"),
    path.join(base, "index.md"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * @param {string} filePath
 * @param {string} importMetaUrl
 */
function walkMdxFiles(dir, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name.startsWith(".")) continue;
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      walkMdxFiles(full, out);
    } else if (
      name.isFile() &&
      (name.name.endsWith(".mdx") || name.name.endsWith(".md"))
    ) {
      out.push(full);
    }
  }
}

/**
 * @param {string} fromFile absolute
 * @param {string} toFile absolute
 * @returns {string}
 */
function relFromTo(fromFile, toFile) {
  const rel = path.relative(path.dirname(fromFile), toFile);
  return rel.split(path.sep).join("/");
}

/**
 * @param {string} content
 * @param {string} filePath abs path to current mdx
 * @returns {{ next: string, rewritten: number, skippedParse: number, unresolvedUrls: string[] }}
 */
function replaceContent(content, filePath) {
  let rewritten = 0;
  let skippedParse = 0;
  /** @type {string[]} */
  const unresolvedUrls = [];
  const next = content.replace(MD_LINK_RE, (full, label, url) => {
    const parsed = parseWorldPath(url);
    if (!parsed) {
      skippedParse += 1;
      return full;
    }
    const { slug, suffix } = parsed;
    const targetAbs = resolveSlugToFile(slug);
    if (!targetAbs) {
      unresolvedUrls.push(url);
      return full;
    }
    const rel = relFromTo(filePath, targetAbs) + suffix;
    rewritten += 1;
    return `[${label}](${rel})`;
  });
  return { next, rewritten, skippedParse, unresolvedUrls };
}

function relWorldPath(absPath) {
  return path.relative(WORLD_ROOT, absPath).split(path.sep).join("/");
}

function main() {
  const { write, dryRun, reportPath } = parseArgs();
  if (!fs.existsSync(WORLD_ROOT)) {
    console.error("Expected world docs at:", WORLD_ROOT);
    process.exit(1);
  }

  const files = [];
  walkMdxFiles(WORLD_ROOT, files);

  let totalRewritten = 0;
  let filesWithRewrites = 0;
  /** @type {Array<{ path: string, rewritten: number, skippedParse: number, unresolvedUrls: string[] }>} */
  const filesStillWithWorldLinks = [];

  for (const file of files) {
    const before = fs.readFileSync(file, "utf8");
    const { next, rewritten, skippedParse, unresolvedUrls } = replaceContent(
      before,
      file,
    );
    const stillHasWorld =
      skippedParse > 0 || unresolvedUrls.length > 0;
    if (stillHasWorld) {
      filesStillWithWorldLinks.push({
        path: file,
        rewritten,
        skippedParse,
        unresolvedUrls,
      });
    }
    if (rewritten > 0) {
      totalRewritten += rewritten;
      filesWithRewrites += 1;
      if (write) {
        fs.writeFileSync(file, next, "utf8");
      }
    }
  }

  const totalUnresolvedUrls = filesStillWithWorldLinks.reduce(
    (acc, e) => acc + e.unresolvedUrls.length,
    0,
  );
  const totalSkippedParse = filesStillWithWorldLinks.reduce(
    (acc, e) => acc + e.skippedParse,
    0,
  );

  console.log(
    dryRun
      ? "Dry run (no files written). Use --write to apply."
      : "Wrote updated files.",
  );
  console.log("World root:", WORLD_ROOT);
  console.log("Files scanned:", files.length);
  console.log("Files with at least one rewritten link:", filesWithRewrites);
  console.log("Link targets rewritten:", totalRewritten);
  console.log("");
  console.log(
    "Files still containing absolute /world/... links (unchanged in those spots):",
    filesStillWithWorldLinks.length,
  );
  console.log(
    "  (missing target slug:",
    totalUnresolvedUrls,
    "| skipped non-doc /world patterns:",
    totalSkippedParse,
    ")",
  );
  for (const entry of filesStillWithWorldLinks) {
    const rel = relWorldPath(entry.path);
    const parts = [];
    if (entry.unresolvedUrls.length)
      parts.push(`${entry.unresolvedUrls.length} unresolved`);
    if (entry.skippedParse)
      parts.push(`${entry.skippedParse} non-doc /world pattern`);
    console.log(`  ${rel}  (${parts.join(", ")})`);
  }

  if (reportPath) {
    const payload = {
      worldRoot: WORLD_ROOT,
      dryRun,
      wrote: write && !dryRun,
      scannedFileCount: files.length,
      filesWithRewrites,
      linksRewritten: totalRewritten,
      filesStillWithWorldLinks: filesStillWithWorldLinks.map((e) => ({
        path: e.path,
        pathRelativeToWorld: relWorldPath(e.path),
        rewritten: e.rewritten,
        skippedParse: e.skippedParse,
        unresolvedUrls: e.unresolvedUrls,
      })),
      totals: {
        unresolvedUrlCount: totalUnresolvedUrls,
        skippedParseCount: totalSkippedParse,
      },
    };
    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("");
    console.log("Wrote JSON report:", reportPath);
  }
}

main();
