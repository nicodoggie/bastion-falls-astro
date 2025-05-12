import { buildCommand } from '@stricli/core';
import type { LocalContext } from "@/context.js";
import * as fs from "node:fs/promises";
import { glob } from "tinyglobby"
import { remark } from 'remark';
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import yaml from 'js-yaml';

function remarkStub() {
  return (tree: Root) => {
    let hasContent = false;
    let isSplash = false;

    // Check if there's any content besides frontmatter
    visit(tree, (node) => {
      const frontmatter: any = node.type === 'yaml' ? yaml.load(node.value) : null;
      isSplash = frontmatter?.template === 'splash';
      hasContent = node.type !== 'root' && node.type !== 'yaml' && node.type !== 'thematicBreak';
    });
    // If no content, add Stub comp
    // onent
    if (!hasContent && !isSplash) {
      tree.children.push({
        type: 'mdxJsxFlowElement',
        name: 'Stub',
        attributes: [],
        children: []
      });
    }
  };
}

export const scanStubCommand = buildCommand({
  async func(this: LocalContext, flags: any, directoryArg: string) {
    const cwd = this.currentPath;
    for (const item of await glob(directoryArg, { cwd })) {
      const filePath = resolve(cwd, item);
      const file = await readFile(filePath, 'utf-8');

      const result = await remark()
        .use(remarkFrontmatter)
        .use(remarkMdx)
        .use(remarkStub)
        .process(file);

      // Only write if content changed
      if (result.toString() !== file) {
        await writeFile(filePath, result.toString());
        console.log(`Updated ${item} with Stub component`);
      }
    }
    this.process.exit(0);
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "path to the directory to be scanned"
        },
      ]
    }
  },
  docs: {
    brief: "Scans for empty articles in an Astro directory and adds Stub components",
  }
});