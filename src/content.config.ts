import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { blogSchema } from "./schemas/BlogPost";

export const collections = {
  blog: defineCollection({
    loader: glob({ pattern: "*.mdx", base: "./src/content/blog" }),
    schema: blogSchema,
  }),
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
