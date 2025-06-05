// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import AutoImport from "astro-auto-import";
import react from "@astrojs/react";
import remarkParse from "remark-parse";
import { remarkDefinitionList } from "remark-definition-list";
import remarkCustomHeaderId from "remark-custom-header-id";
import tailwindcss from "@tailwindcss/vite";
import flowbiteReact from "flowbite-react/plugin/astro";
import expressiveCode from "astro-expressive-code";
import starlightLinksValidator from "starlight-links-validator";

export default defineConfig({
  output: "static",
  markdown: {
    remarkPlugins: [
      remarkCustomHeaderId,
      remarkParse,
      remarkDefinitionList,
    ],
  },
  integrations: [
    react(),
    expressiveCode(),
    starlight({
      title: "Bastion Falls",
      favicon: "/favicon.png",
      logo: {
        src: "/src/assets/orb-of-bastion.png",
        alt: "Bastion Falls",
      },
      customCss: ["/src/styles/global.css"],
      social: [
        {
          icon: "laptop",
          label: "Blog",
          href: "/blog",
        },
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/nicodoggie/bastion-falls",
        },
      ],
      components: {
        PageSidebar: "./src/components/PageSidebar.astro",
      },
      plugins: [
        starlightLinksValidator({
          components: [["SeeAlso", "href"]],
          errorOnInvalidHashes: false,
        }),
      ],
    }),
    AutoImport({
      imports: [
        "./src/components/Spell.astro",
        "./src/components/Stub.astro",
        "./src/components/FamilyTree.tsx",
        "./src/components/HomebrewSpell.astro",
        "./src/components/Incomplete.astro",
        "./src/components/Map.astro",
        "./src/components/Monster.astro",
        "./src/components/OutOfDate.astro",
        "./src/components/SeeAlso.astro",
      ],
    }),
  ],
  experimental: {
    contentIntellisense: true,
    responsiveImages: true,
  },
  vite: {
    plugins: [
      tailwindcss(),
      flowbiteReact(),
    ],
  },
});