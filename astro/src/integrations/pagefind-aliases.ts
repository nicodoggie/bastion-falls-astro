import type { Root } from 'mdast';

/**
 * Remark plugin that injects character aliases into page content for Pagefind indexing
 */
export function pagefindAliases() {
  return function (tree: Root, file: any) {
    // Get frontmatter from the file
    const frontmatter = (file.data as any)?.astro?.frontmatter;
    debugger;
    if (!frontmatter) return;

    // Check if this is a character page with aliases
    const hasAliases = frontmatter?.character?.details?.aliases &&
      Array.isArray(frontmatter.character.details.aliases) &&
      frontmatter.character.details.aliases.length > 0;

    if (!hasAliases) return;

    const aliases = frontmatter.character.details.aliases;
    const aliasText = aliases.join(', ');

    // Create a visually hidden span with aliases for Pagefind indexing
    const aliasNode = {
      type: 'html' as const,
      value: `<span class="sr-only">Also known as: ${aliasText}</span>`,
    };

    // Insert the alias node at the beginning of the document
    tree.children.unshift(aliasNode);
  };
}