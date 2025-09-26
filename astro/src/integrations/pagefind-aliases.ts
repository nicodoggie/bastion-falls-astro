import type { AstroIntegration } from 'astro';

/**
 * Remark plugin that injects character aliases into page content for Pagefind indexing
 */
function remarkPagefindAliases() {
  return function (tree: any, file: any) {
    // Get frontmatter from the file
    const frontmatter = (file.data as any)?.astro?.frontmatter;

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

/**
 * Astro integration that adds the remark plugin for alias injection
 */
export function pagefindAliases(): AstroIntegration {
  return {
    name: 'pagefind-aliases',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          markdown: {
            remarkPlugins: [remarkPagefindAliases],
          },
        });
      },
    },
  };
}

/**
 * Helper function to generate hidden alias content for Pagefind indexing
 */
export function generateAliasContent(aliases: string[]): string {
  if (!aliases || aliases.length === 0) return '';

  const aliasText = aliases.join(', ');
  return `<span class="sr-only">Also known as: ${aliasText}</span>`;
}

/**
 * Helper function to check if a page has character data with aliases
 */
export function hasCharacterAliases(frontmatter: any): boolean {
  return frontmatter?.character?.details?.aliases &&
    Array.isArray(frontmatter.character.details.aliases) &&
    frontmatter.character.details.aliases.length > 0;
}