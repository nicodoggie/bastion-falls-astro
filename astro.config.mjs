// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import AstroBlog from "astro-blog";
import deno from "@astrojs/deno";
import AutoImport from "astro-auto-import";
import mdx from "@astrojs/mdx";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: deno(),
  integrations: [
    AutoImport({
      imports: ["./src/components/Spell.astro", "./src/components/Stub.astro"],
    }),
    AstroBlog({
      title: "Bastion Falls Blog",
    }),
    starlight({
      title: "Bastion Falls",
      components: {
        HomebrewSpell: "./src/components/HomebrewSpell.astro",
        Spell: "./src/components/Spell.astro",
        Stub: "./src/components/Stub.astro",
        Incomplete: "./src/components/Incomplete.astro",
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
    mdx(),
  ],
});
