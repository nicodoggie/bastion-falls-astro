// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import AstroBlog from "astro-blog";
import deno from "@astrojs/deno";
import AutoImport from "astro-auto-import";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import remarkParse from "remark-parse";
import {
  remarkDefinitionList,
  defListHastHandlers,
} from "remark-definition-list";
import remarkCustomHeaderId from "remark-custom-header-id";
import remarkRehype from "remark-rehype";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: deno(),
  markdown: {
    remarkPlugins: [remarkParse, remarkDefinitionList, remarkCustomHeaderId],
    rehypePlugins: [],
  },
  integrations: [
    react(),
    AutoImport({
      imports: ["./src/components/Spell.astro", "./src/components/Stub.astro"],
    }),
    AstroBlog({
      title: "Bastion Falls Blog",
    }),
    starlight({
      title: "Bastion Falls",
      components: {
        FamilyTree: "./src/components/FamilyTree.astro",
        HomebrewSpell: "./src/components/HomebrewSpell.astro",
        Incomplete: "./src/components/Incomplete.astro",
        Map: "./src/components/Map.astro",
        Monster: "./src/components/Monster.astro",
        OutOfDate: "./src/components/OutOfDate.astro",
        SeeAlso: "./src/components/SeeAlso.astro",
        Spell: "./src/components/Spell.astro",
        Stub: "./src/components/Stub.astro",
      },
      social: [
        {
          icon: "laptop",
          label: "Blog",
          href: "/blog",
        },
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/withastro/starlight",
        },
      ],
    }),
    mdx({
      remarkPlugins: [remarkParse, remarkDefinitionList, remarkCustomHeaderId],
    }),
  ],
});
