import { defineCollection, type SchemaContext } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { ItemDataSchema, SpellDataSchema } from "@bastion-falls/5e-schema-zod";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { autoSidebarLoader } from "starlight-auto-sidebar/loader";
import { autoSidebarSchema } from "starlight-auto-sidebar/schema";
import { collectionExtensions, docsExtension } from "./collection-schemas.js";

const baseBlogSchema = z.object({
  title: z.string(),
  draft: z.boolean().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const blogSchema = (context: SchemaContext) => {
  const { image } = context;
  return z.discriminatedUnion("draft", [
    baseBlogSchema.extend({
      draft: z.literal(false),
      published: z.date(),
      updated: z.date().optional(),
      banner: z
        .object({
          url: image(),
          alt: z.string().optional(),
        })
        .optional(),
    }),
    baseBlogSchema.extend({
      draft: z.undefined(),
      published: z.date(),
      updated: z.date().optional(),
      banner: z
        .object({
          url: image(),
          alt: z.string().optional(),
        })
        .optional(),
    }),
    baseBlogSchema.extend({
      draft: z.literal(true),
      banner: z
        .object({
          url: image(),
          alt: z.string().optional(),
        })
        .optional(),
    }),
  ]);
};

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
    schema: blogSchema,
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
