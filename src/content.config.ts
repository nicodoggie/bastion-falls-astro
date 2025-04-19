import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { ArticleSchema, AuthorSchema, TagSchema } from "astro-blog/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  blog: defineCollection({
    type: "content",
    schema: ArticleSchema,
  }),
  author: defineCollection({
    type: "content",
    schema: AuthorSchema,
  }),
  tag: defineCollection({
    type: "content",
    schema: TagSchema,
  }),
};
