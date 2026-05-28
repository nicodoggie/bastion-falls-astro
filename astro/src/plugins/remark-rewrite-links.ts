import path from "node:path";
import type { Nodes, Parents, Root } from "mdast";
import type { VFile } from "vfile";
import { rewriteDocsUrl, toDocsUrl } from "../helpers/docs-links";

export { toDocsUrl };

interface LinkMapping {
  from: string;
  to: string;
}

interface RemarkRewriteLinksOptions {
  mappings?: LinkMapping[];
  docsRoot?: string;
  trailingSlash?: boolean;
}

interface RewriteUrlOptions {
  currentDoc: string | null;
  mappings: LinkMapping[];
  trailingSlash: boolean;
}

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
}: RemarkRewriteLinksOptions = {}) {
  return (tree: Root, file: VFile) => {
    const currentDoc = getDocRelativePath(file?.path, docsRoot);

    visit(tree, (node: Nodes) => {
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

function visit(nodes: Nodes, visitor: (visitorNodes: Nodes) => void) {
  visitor(nodes);
  if (!isParent(nodes)) return;
  for (const child of nodes.children) {
    visit(child, visitor);
  }
}

function isParent(node: Nodes): node is Parents {
  return "children" in node;
}
