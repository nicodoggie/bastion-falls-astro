import path from "node:path";

/**
 * Rewrites markdown links to stable docs URLs.
 *
 * - Resolves relative links against the current source file location.
 * - Strips `.md`/`.mdx` and emits trailing-slash docs URLs.
 * - Also rewrites markdown links inside `markmap` code fences.
 * - Optional prefix mappings: [{ from: '/a', to: '/b' }].
 */
export default function remarkRewriteLinks({
  mappings = [],
  docsRoot = "src/content/docs",
  trailingSlash = true,
} = {}) {
  return (tree, file) => {
    const currentDoc = getDocRelativePath(file?.path, docsRoot);

    visit(tree, (node) => {
      if (node.type === "link" && typeof node.url === "string") {
        const rewritten = rewriteUrl(node.url, {
          currentDoc,
          mappings,
          trailingSlash,
        });
        if (rewritten) node.url = rewritten;
      }

      if (
        node.type === "code" &&
        node.lang === "markmap" &&
        typeof node.value === "string"
      ) {
        node.value = rewriteMarkdownLinksInText(
          node.value,
          (url) =>
            rewriteUrl(url, { currentDoc, mappings, trailingSlash }) ?? url,
        );
      }
    });
  };
}

function rewriteUrl(url, { currentDoc, mappings, trailingSlash }) {
  if (!url || isExternalOrAnchor(url)) return null;

  const [base, suffix] = splitSuffix(url);
  let target = base;

  if (isRelative(target) && currentDoc) {
    const fromDir = path.posix.dirname(currentDoc);
    target = path.posix.normalize(path.posix.join(fromDir, target));
  }

  target = applyMappings(target, mappings);
  target = toDocsUrl(target, trailingSlash);
  return target + suffix;
}

function rewriteMarkdownLinksInText(text, rewriteUrlFn) {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, rawUrl) => {
    const nextUrl = rewriteUrlFn(rawUrl);
    return `[${label}](${nextUrl})`;
  });
}

function getDocRelativePath(filePath, docsRoot) {
  if (!filePath) return null;
  const normalizedPath = filePath.split(path.sep).join("/");
  const normalizedRoot = docsRoot.replace(/^\/+|\/+$/g, "");
  const marker = `/${normalizedRoot}/`;
  const markerIndex = normalizedPath.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  return normalizedPath.slice(markerIndex + marker.length);
}

function applyMappings(url, mappings) {
  for (const { from, to } of mappings) {
    if (url.startsWith(from)) {
      return to + url.slice(from.length);
    }
  }
  return url;
}

function toDocsUrl(url, trailingSlash) {
  let out = url.replace(/\\/g, "/");
  out = out.replace(/\.mdx?$/, "");
  out = out.replace(/\/index$/, "/");
  if (!out.startsWith("/")) out = `/${out}`;
  if (trailingSlash && !out.endsWith("/")) out = `${out}/`;
  return out;
}

function splitSuffix(url) {
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");

  if (hashIndex === -1 && queryIndex === -1) return [url, ""];
  if (hashIndex === -1)
    return [url.slice(0, queryIndex), url.slice(queryIndex)];
  if (queryIndex === -1) return [url.slice(0, hashIndex), url.slice(hashIndex)];

  const splitAt = Math.min(hashIndex, queryIndex);
  return [url.slice(0, splitAt), url.slice(splitAt)];
}

function isExternalOrAnchor(url) {
  return (
    url.startsWith("#") ||
    url.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)
  );
}

function isRelative(url) {
  return !url.startsWith("/");
}

function visit(node, visitor) {
  visitor(node);
  if (!node?.children) return;
  for (const child of node.children) {
    visit(child, visitor);
  }
}
