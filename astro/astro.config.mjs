import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import starlightFlattenIndex from '@bastion-falls/starlight-flatten-index';
import tailwindcss from '@tailwindcss/vite';
import AutoImport from 'astro-auto-import';
import expressiveCode from 'astro-expressive-code';
import { defineConfig } from 'astro/config';
import flowbiteReact from 'flowbite-react/plugin/astro';
import remarkCustomHeaderId from 'remark-custom-header-id';
import { remarkDefinitionList } from 'remark-definition-list';
import remarkParse from 'remark-parse';
import starlightAutoSidebar from 'starlight-auto-sidebar';

export default defineConfig({
  output: 'static',
  site: 'https://bastion-falls.thekennel.info',
  markdown: {
    remarkPlugins: [
      remarkCustomHeaderId,
      remarkParse,
      remarkDefinitionList,
    ],
  },
  redirects: {
    '/locations/confederation-of-apgarian-states': '/locations/apgar',
  },
  integrations: [
    react(),
    expressiveCode(),
    sitemap(),
    starlight({
      title: 'Bastion Falls',
      favicon: '/favicon.png',
      logo: {
        src: '/src/assets/orb-of-bastion.png',
        alt: 'Bastion Falls',
      },
      customCss: ['/src/styles/global.css'],
      head: [
        {
          tag: 'script',
          attrs: {
            src: 'https://app.fantasy-calendar.com/js/embed.js',
          },
        },
        {
          tag: 'script',
          children: `
          window.addEventListener('load', function() {
            if (typeof FantasyCalendar !== 'undefined') {
              FantasyCalendar({
                hash: '089e518f9ea966373b1c71535c25b98a',
                settings: {
                  theme: 'custom',
                  size: 'sm',
                  current_date_color: '#613583',
                },
              });
            }
          });
        `,
        },
      ],
      social: [
        {
          icon: 'laptop',
          label: 'Blog',
          href: '/blog',
        },
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/nicodoggie/bastion-falls-astro',
        },
      ],
      sidebar: [
        {
          label: 'Blog',
          link: '/blog',
        },
        {
          label: 'World',
          autogenerate: {
            directory: 'world',
          },
        },
      ],
      components: {
        PageSidebar: './src/components/PageSidebar.astro',
      },
      plugins: [
        starlightAutoSidebar(),
        starlightFlattenIndex(),
      ],
    }),
    AutoImport({
      imports: [
        './src/components/Spell.astro',
        './src/components/Stub.astro',
        './src/components/FamilyTree.tsx',
        './src/components/HomebrewSpell.astro',
        './src/components/Incomplete.astro',
        './src/components/Map.astro',
        './src/components/Monster.astro',
        './src/components/OutOfDate.astro',
        './src/components/SeeAlso.astro',
      ],
    }),
    mdx(),
    sitemap(),
  ],
  vite: {
    plugins: [
      tailwindcss(),
      flowbiteReact(),
    ],
  },
});
