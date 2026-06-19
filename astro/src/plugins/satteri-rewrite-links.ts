import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteDocsUrl, toDocsUrl } from "../helpers/docs-links";

export { toDocsUrl };

interface LinkMapping {
  from: string;
  to: string;
}

interface SatteriRewriteLinksOptions {
  mappings?: LinkMapping[];
  docsRoot?: string;
  trailingSlash?: boolean;
}

interface RewriteUrlOptions {
  currentDoc: string | null;
  mappings: LinkMapping[];
  trailingSlash: boolean;
}

interface SatteriLinkNode {
  type: "link";
  url?: string;
}

interface SatteriCodeNode {
  type: "code";
  lang?: string | null;
  value?: string;
}

interface SatteriVisitorContext {
  filename?: string;
  fileURL?: URL;
  setProperty(node: unknown, key: string, value: unknown): void;
}

interface SatteriRewriteLinksPlugin {
  name: string;
  link(node: Readonly<SatteriLinkNode>, ctx: SatteriVisitorContext): void;
  code(node: Readonly<SatteriCodeNode>, ctx: SatteriVisitorContext): void;
}

/**
 * Rewrites Satteri markdown links to stable docs URLs.
 *
 * - Resolves relative links against the current source file location.
 * - Strips `.md`/`.mdx` and emits trailing-slash docs URLs.
 * - Also rewrites markdown links inside `markmap` code fences.
 * - Optional prefix mappings: [{ from: '/a', to: '/b' }].
 */
export default function satteriRewriteLinks({
  mappings = [],
  docsRoot = "src/content/docs",
  trailingSlash = true,
}: SatteriRewriteLinksOptions = {}): SatteriRewriteLinksPlugin {
  return {
    name: "rewrite-links",
    link(node, ctx) {
      if (typeof node.url !== "string") return;

      const rewritten = rewriteUrl(node.url, {
        currentDoc: getCurrentDoc(ctx, docsRoot),
        mappings,
        trailingSlash,
      });
      if (rewritten) ctx.setProperty(node, "url", rewritten);
    },
    code(node, ctx) {
      if (node.lang !== "markmap" || typeof node.value !== "string") return;

      const currentDoc = getCurrentDoc(ctx, docsRoot);
      const rewritten = rewriteMarkdownLinksInText(
        node.value,
        (url) =>
          rewriteUrl(url, { currentDoc, mappings, trailingSlash }) ?? url,
      );
      if (rewritten !== node.value) {
        ctx.setProperty(node, "value", rewritten);
      }
    },
  };
}

function rewriteUrl(
  url: string,
  { currentDoc, mappings, trailingSlash }: RewriteUrlOptions,
) {
  if (!url || isExternalOrAnchor(url)) return null;

  return rewriteDocsUrl(url, {
    currentPath: currentDoc,
    mappings,
    trailingSlash,
  });
}

function rewriteMarkdownLinksInText(
  text: string,
  rewriteUrlFn: (url: string) => string,
) {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, rawUrl) => {
    const nextUrl = rewriteUrlFn(rawUrl);
    return `[${label}](${nextUrl})`;
  });
}

function getCurrentDoc(ctx: SatteriVisitorContext, docsRoot: string) {
  if (ctx.filename) return getDocRelativePath(ctx.filename, docsRoot);
  if (!ctx.fileURL) return null;
  return getDocRelativePath(fileURLToPath(ctx.fileURL), docsRoot);
}

function getDocRelativePath(filePath: string | undefined, docsRoot: string) {
  if (!filePath) return null;
  const normalizedPath = filePath.split(path.sep).join("/");
  const normalizedRoot = docsRoot.replace(/^\/+|\/+$/g, "");
  const marker = `/${normalizedRoot}/`;
  const markerIndex = normalizedPath.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  return normalizedPath.slice(markerIndex + marker.length);
}

function isExternalOrAnchor(url: string) {
  return (
    url.startsWith("#") ||
    url.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)
  );
}
