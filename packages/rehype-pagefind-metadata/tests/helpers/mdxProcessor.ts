import yaml from 'js-yaml';
import type { Root } from 'mdast';
import { readFile } from 'node:fs/promises';
import rehypeDocument from 'rehype-document';
import rehypeFormat from 'rehype-format';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import type { VFile } from 'vfile';
import { remark } from 'remark';

export async function mdxProcessor(file: string) {
  let yamlFrontmatter: string;
  const processor = remark()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkFrontmatter)
    .use(function () {
      return (tree: Root, file: VFile) => {
        const yamlNode = tree.children.find((child: any) => child.type === 'yaml');

        if (yamlNode?.type === 'yaml') {
          file.data.astro = {
            frontmatter: yaml.load(yamlNode.value)
          }
        }
      }
    })

  const fileContent = await readFile(file, 'utf-8');

  return processor.process(fileContent);
}