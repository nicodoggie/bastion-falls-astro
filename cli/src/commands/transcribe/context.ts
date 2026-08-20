import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { glob } from "tinyglobby";
import yaml from "js-yaml";

export interface ContextFile {
  path: string;
  content: string;
}

export interface BuildContextOptions {
  contextRoot: string;
  campaign: string;
  outDir: string;
  maxFiles?: number;
  excludePathFragments?: readonly string[];
}

function titleFromSlug(path: string): string {
  const stem = basename(path, extname(path)).replace(/\.(creature|item|spell|vehicle)$/, "");
  return stem
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function frontmatter(content: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match?.[1]) {
    return {};
  }
  const parsed = yaml.load(match[1]);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function headings(content: string): string[] {
  return [...content.matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
}

function jsonNames(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string") {
      return [parsed.name];
    }
  } catch {
    return [];
  }
  return [];
}

export function extractGlossaryEntries(files: ContextFile[]): string[] {
  const entries = new Set<string>();
  for (const file of files) {
    const fm = frontmatter(file.content);
    if (typeof fm["title"] === "string") {
      entries.add(fm["title"]);
    }
    for (const heading of headings(file.content)) {
      entries.add(heading);
    }
    for (const name of jsonNames(file.content)) {
      entries.add(name);
    }
    const slugTitle = titleFromSlug(file.path);
    if (slugTitle && slugTitle.toLowerCase() !== "index") {
      entries.add(slugTitle);
    }
  }
  return [...entries].sort((a, b) => a.localeCompare(b));
}

function contextPriority(path: string, campaign: string): number {
  if (path.includes(`/notes/${campaign}/`) || path.includes(`/campaign-prep/${campaign}/`)) {
    return 0;
  }
  if (path.includes("/characters/") || path.includes("/locations/") || path.includes("/organizations/")) {
    return 1;
  }
  if (path.includes("/items/") || path.includes("/families/") || path.includes("/events/")) {
    return 2;
  }
  return 3;
}

export async function collectContextFiles(options: BuildContextOptions): Promise<ContextFile[]> {
  const matches = await glob("**/*.{md,mdx,json,yml,yaml}", {
    cwd: options.contextRoot,
    ignore: ["help/**"],
  });
  const ordered = matches
    .filter((path) => !(options.excludePathFragments ?? []).some((fragment) => fragment && path.includes(fragment)))
    .sort((a, b) => contextPriority(a, options.campaign) - contextPriority(b, options.campaign) || a.localeCompare(b))
    .slice(0, options.maxFiles ?? 300);

  return Promise.all(
    ordered.map(async (path) => ({
      path,
      content: await readFile(join(options.contextRoot, path), "utf8"),
    })),
  );
}

export async function writeGlossary(options: BuildContextOptions): Promise<string> {
  const files = await collectContextFiles(options);
  const entries = extractGlossaryEntries(files);
  const content = [`# Campaign Glossary`, "", ...entries.map((entry) => `- ${entry}`), ""].join("\n");
  const outPath = join(options.outDir, "context", "glossary.md");
  await mkdir(join(options.outDir, "context"), { recursive: true });
  await writeFile(outPath, content, "utf8");
  return outPath;
}

export function buildContextExcerpt(files: ContextFile[], contextRootLabel = "astro/src/content/docs"): string {
  return files
    .map((file) => {
      const trimmed = file.content.slice(0, 4_000);
      return `## ${relative(".", join(contextRootLabel, file.path))}\n\n${trimmed}`;
    })
    .join("\n\n---\n\n");
}
