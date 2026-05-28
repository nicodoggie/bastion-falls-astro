import path from "node:path";

interface LinkMapping {
  from: string;
  to: string;
}

interface RewriteDocsUrlOptions {
  currentPath?: string | null;
  mappings?: LinkMapping[];
  trailingSlash?: boolean;
}

export function rewriteDocsUrl(
  url: string,
  {
    currentPath,
    mappings = [],
    trailingSlash = true,
  }: RewriteDocsUrlOptions = {},
) {
  if (!url || isExternalOrAnchor(url)) return url;

  const [base, suffix] = splitSuffix(url);
  let target = base;

  if (isRelative(target) && currentPath) {
    const fromDir = path.posix.dirname(currentPath);
    target = path.posix.normalize(path.posix.join(fromDir, target));
  }

  target = applyMappings(target, mappings);
  target = toDocsUrl(target, trailingSlash);
  return target + suffix;
}

export function toDocsUrl(url: string, trailingSlash?: boolean) {
  let out = url.replace(/\\/g, "/");
  out = out.replace(/\.mdx?$/, "");
  out = out.replace(/\/index$/, "/");
  if (!out.startsWith("/")) out = `/${out}`;
  if (trailingSlash && !out.endsWith("/")) out = `${out}/`;
  return out;
}

function applyMappings(url: string, mappings: LinkMapping[]) {
  for (const { from, to } of mappings) {
    if (url.startsWith(from)) {
      return to + url.slice(from.length);
    }
  }
  return url;
}

function splitSuffix(url: string): [string, string] {
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");

  if (hashIndex === -1 && queryIndex === -1) return [url, ""];
  if (hashIndex === -1)
    return [url.slice(0, queryIndex), url.slice(queryIndex)];
  if (queryIndex === -1) return [url.slice(0, hashIndex), url.slice(hashIndex)];

  const splitAt = Math.min(hashIndex, queryIndex);
  return [url.slice(0, splitAt), url.slice(splitAt)];
}

function isExternalOrAnchor(url: string) {
  return (
    url.startsWith("#") ||
    url.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)
  );
}

function isRelative(url: string) {
  return !url.startsWith("/");
}
