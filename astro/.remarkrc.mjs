import remarkMdx from "remark-mdx";
import { remarkDefinitionList } from "remark-definition-list";
import remarkLint from "remark-lint";
import remarkLintMaximumLineLength from "remark-lint-maximum-line-length";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import remarkFrontmatter from "remark-frontmatter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkPrettier from "remark-prettier";
import remarkCustomHeaderId from "remark-custom-header-id";

import remarkWikiLink from "remark-wiki-link";

// prettier-ignore
const processor = unified()
  .use(remarkParse)
  .use(
    remarkStringify, {
      bullet: "-",
      emphasis: "_",
      strong: "**",
      fence: "`",
      fences: true,
      incrementListMarker: true,
      listItemIndent: "one",
      tightDefinitions: true,
      stringLength: 80,
      wrap: "always",
    })
  .use(remarkPrettier);

const remarkConfig = {
  processor,
  plugins: [
    remarkFrontmatter,
    remarkGfm,
    remarkMdx,
    remarkDefinitionList,
    remarkLint,
    remarkCustomHeaderId,
    [
      remarkLintMaximumLineLength,
      [
        "warning",
        80,
      ],
    ],
  ],
};

export default remarkConfig;
