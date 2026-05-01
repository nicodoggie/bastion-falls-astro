import type { Root } from 'mdast';
import type { VFile } from 'vfile';
/**
 * Remark plugin that injects character aliases into page content for Pagefind indexing
 */
export function pagefindAliases() {
  return (tree: Root, file: VFile) => {
    // Get frontmatter from the file
    const frontmatter = file.data?.astro?.frontmatter;
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