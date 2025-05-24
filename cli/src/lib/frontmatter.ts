import { readFile } from "node:fs/promises";
import { remark } from 'remark';
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";
import yaml from 'js-yaml';
import type { Root, Yaml } from "mdast";

export async function parse(fileName: string){
  const file = await readFile(fileName, 'utf8');
  let yamlFrontmatter: Record<string, any> = {};
  const result = await remark()
  .use(remarkMdx)
  .use(remarkFrontmatter)
    .use(function() {
      return (tree: Root) => {
        tree.children.forEach((child: any) => {
          if(child.type === 'yaml') {
            yamlFrontmatter = yaml.load(child.value) as Record<string, any>;
          }
        });
      };
    })
    .process(file);

  return yamlFrontmatter;
}

export async function replace(fileName: string, frontmatter: Record<string, any>) {
  const file = await readFile(fileName, 'utf8');
  const result = await remark()
    .use(remarkMdx)
    .use(remarkFrontmatter)
    .use(function() {
      return (tree: Root) => {
        tree.children.forEach((child: any) => {
          if(child.type === 'yaml') {
            child.value = yaml.dump(frontmatter);
          }
        });
      };
    })
    .use(remarkStringify)
    .process(file);


  return result.toString();
}