import yaml from 'js-yaml';
import { readFile } from 'node:fs/promises';
import rehypeDocument from 'rehype-document';
import rehypeFormat from 'rehype-format';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { remark } from 'remark';
export async function mdxProcessor(file) {
    let yamlFrontmatter;
    const processor = remark()
        .use(remarkParse)
        .use(remarkMdx)
        .use(remarkFrontmatter)
        .use(function () {
        return (tree, file) => {
            const yamlNode = tree.children.find((child) => child.type === 'yaml');
            if (yamlNode?.type === 'yaml') {
                file.data.astro = {
                    frontmatter: yaml.load(yamlNode.value)
                };
            }
        };
    });
    const fileContent = await readFile(file, 'utf-8');
    return processor.process(fileContent);
}
//# sourceMappingURL=mdxProcessor.js.map