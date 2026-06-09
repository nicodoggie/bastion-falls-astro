import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { lexiconIntegration } from "@bastion-falls/astro-lexicon-integration";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import AutoImport from "astro-auto-import";
import expressiveCode from "astro-expressive-code";
import mermaid from "astro-mermaid";
import flowbiteReact from "flowbite-react/plugin/astro";
import remarkCustomHeaderId from "remark-custom-header-id";
import { remarkDefinitionList } from "remark-definition-list";
import remarkMarkmap from "remark-markmap";
import remarkParse from "remark-parse";
import starlightAutoSidebar from "starlight-auto-sidebar";
import { timelineGenerator } from "./src/integrations/timeline-generator.ts";
import { vscodeFrontmatterSchemas } from "./src/integrations/vscode-frontmatter-schemas.ts";
import remarkRewriteLinks from "./src/plugins/remark-rewrite-links.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const lexurgyLang = JSON.parse(
  fs.readFileSync(
    new URL("./src/languages/lexurgy.tmLanguage.json", import.meta.url),
    "utf-8",
  ),
);

export default defineConfig({
  output: "static",
  site: "https://bastion-falls.thekennel.info",
  markdown: {
    remarkPlugins: [
      remarkCustomHeaderId,
      remarkParse,
      remarkDefinitionList,
      remarkRewriteLinks,
      [remarkMarkmap, { darkThemeSelector: () => '[data-theme="dark"]' }],
    ],
  },
  redirects: {
    "/locations/confederation-of-apgarian-states": "/locations/apgar",
  },
  integrations: [
    react(),
    mermaid(),
    expressiveCode({
      shiki: {
        langs: [lexurgyLang],
      },
    }),
    sitemap(),
    starlight({
      title: "Bastion Falls",
      favicon: "/favicon.png",
      logo: {
        src: "/src/assets/orb-of-bastion.png",
        alt: "Bastion Falls",
      },
      customCss: ["/src/styles/global.css"],
      head: [
        {
          tag: "script",
          attrs: {
            src: "https://app.fantasy-calendar.com/js/embed.js",
          },
        },
        {
          tag: "script",
          attrs: { src: "/scripts/markmap-modal.js" },
        },
      ],
      social: [
        {
          icon: "laptop",
          label: "Blog",
          href: "/blog",
        },
        {
          icon: "open-book",
          label: "5e.tools Homebrew Bestiary",
          href: "/homebrew/bastion-falls-bestiary.json",
        },
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/nicodoggie/bastion-falls-astro",
        },
      ],
      sidebar: [
        {
          label: "Timeline",
          link: "/world/timeline/timeline-generated",
        },
        {
          label: "Blog",
          link: "/blog",
        },
        {
          label: "World",
          items: [
            {
              autogenerate: {
                directory: "world",
              },
            },
          ],
        },
        {
          label: "Help",
          items: [
            {
              autogenerate: {
                directory: "help",
              },
            },
          ],
        },
      ],
      components: {
        PageSidebar: "./src/components/PageSidebar.astro",
        Sidebar: "./src/components/starlight/Sidebar.astro",
      },
      plugins: [starlightAutoSidebar()],
    }),

    AutoImport({
      imports: [
        "./src/components/inline-references/Spell.astro",
        "./src/components/inline-references/Item.astro",
        "./src/components/inline-references/Creature.astro",
        "./src/components/inline-references/Feat.astro",
        "./src/components/inline-references/ConditionDisease.astro",
        "./src/components/inline-references/Sense.astro",
        "./src/components/Stub.astro",
        "./src/components/FamilyTree.tsx",
        "./src/components/HomebrewSpell.astro",
        "./src/components/Incomplete.astro",
        "./src/components/MapViewer.tsx",
        "./src/components/Monster.astro",
        "./src/components/OutOfDate.astro",
        "./src/components/SeeAlso.astro",
        "./src/components/VehicleStatBlock.astro",
        "./src/components/Redirect.astro",
        "./src/components/EventInfoCard.astro",
      ],
    }),
    mdx({
      extendMarkdownConfig: true,
    }),
    sitemap(),
    vscodeFrontmatterSchemas(),
    timelineGenerator(),
    lexiconIntegration({
      localeId: "early-hick",
      title: "Early Hick Lexicon",
      lexiconGlob:
        "src/assets/languages/hickic/seneran/early-hick/lexicon/*.jsonld",
      outputDir: "src/generated/lexicon/early-hick",
      pageSize: 80,
      starlightMdx: {
        contentLexiconDirRelative:
          "src/content/docs/world/languages/hickic/seneran/early-hick/lexicon",
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss(), flowbiteReact()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
  experimental: {
    rustCompiler: true,
    contentIntellisense: true,
  },
});
