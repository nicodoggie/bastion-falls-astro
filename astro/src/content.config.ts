import { defineCollection } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { ItemDataSchema, SpellDataSchema } from "@bastion-falls/5e-schema-zod";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { autoSidebarLoader } from "starlight-auto-sidebar/loader";
import { autoSidebarSchema } from "starlight-auto-sidebar/schema";
import { blogSchema } from "./blog-schema.js";
import { collectionExtensions, docsExtension } from "./collection-schemas.js";

const extensions = Object.fromEntries(
  Object.entries(collectionExtensions).map(([key, value]) => [
    key,
    defineCollection({
      loader: glob(value.loader),
      schema: docsSchema({ extend: value.schema }),
    }),
  ]),
);

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({ extend: docsExtension }),
  }),
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema(),
  }),
  autoSidebar: defineCollection({
    loader: autoSidebarLoader(),
    schema: autoSidebarSchema(),
  }),
  posts: defineCollection({
    loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
    schema: ({ image }) => blogSchema(image),
  }),
  creatures: defineCollection({
    loader: glob({
      pattern: "**/*.creature.{json,yaml,yml}",
      base: "./src/content/docs/world",
      generateId: ({ entry }) => entry.replace(/\.(json|ya?ml)$/, ""),
    }),
    schema: z.record(z.string(), z.unknown()),
  }),
  spells: defineCollection({
    loader: glob({
      pattern: "**/*.spell.{json,yaml,yml}",
      base: "./src/content/docs/world",
      generateId: ({ entry }) => entry.replace(/\.(json|ya?ml)$/, ""),
    }),
    schema: SpellDataSchema,
  }),
  itemData: defineCollection({
    loader: glob({
      pattern: "**/*.item.{json,yaml,yml}",
      base: "./src/content/docs/world",
      generateId: ({ entry }) => entry.replace(/\.(json|ya?ml)$/, ""),
    }),
    schema: ItemDataSchema,
  }),
  ...extensions,
};
