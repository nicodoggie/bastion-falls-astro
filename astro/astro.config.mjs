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
import starlightAutoSidebar from "starlight-auto-sidebar";
import { pagefindAliases } from "./src/integrations/pagefind-aliases";

export default defineConfig({
  output: "static",
  site: "https://bastion-falls.thekennel.info",
  markdown: {
    remarkPlugins: [
      remarkCustomHeaderId,
      remarkParse,
      remarkDefinitionList,
      // pagefindAliases,
    ],
  },
  redirects: {
    "/locations/confederation-of-apgarian-states": "/locations/apgar",
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
      sidebar: [
        {
          label: "World",
          autogenerate: {
            directory: "world",
          },
        },
        {
          label: "Blog",
          autogenerate: {
            directory: "blog",
          },
        }
      ],
      components: {
        PageSidebar: "./src/components/PageSidebar.astro",
      },      
      plugins: [
        starlightAutoSidebar(),
      //   starlightLinksValidator({
      //     components: [["SeeAlso", "href"]],
      //     errorOnInvalidHashes: false,
      //   }),
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
  vite: {
    plugins: [
      tailwindcss(),
      flowbiteReact(),
    ],
  },
});