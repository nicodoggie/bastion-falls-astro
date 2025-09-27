import type { VFile } from 'vfile';
import type { Root as HAST, Element } from 'hast';
import type { Character } from '@bastion-falls/types';

export interface BastionFallsCharacterVFile extends VFile {
  data: {
    astro?: {
      frontmatter?: {
        character?: Character;
      }
    }
  }
}

export function rehypePagefindMetadata() {
  return function (tree: HAST, file: VFile) {
    const data = file.data as BastionFallsCharacterVFile['data'];
    console.log(data);
    const frontmatter = data.astro?.frontmatter;

    if (!frontmatter?.character) return tree;
    const character = frontmatter.character;

    if (!character.details?.aliases) return tree;

    const aliases = character.details.aliases || [];
    const htmlNode: Element | undefined = tree.children.find(
      c => c.type === 'element' && c.tagName === 'html') as Element;
    const bodyNode: Element | undefined = htmlNode?.children.find(c => c.type === 'element' && c.tagName === 'body') as Element;

    for (const alias of aliases) {
      bodyNode.children.push({
        type: 'element',
        tagName: 'span',
        properties: {
          'data-pagefind-meta': 'alias',
          class: 'sr-only',
        },
        children: [{
          type: 'text',
          value: `aka: ${alias}`,
        }],
      });
    }

    return tree;
  };
}