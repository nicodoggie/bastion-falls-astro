import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { blogSchema } from "./schemas/BlogPost";
import { LocationSchema } from '@bastion-falls/types';
import { CharacterSchema } from '@bastion-falls/types';
import { EventSchema } from '@bastion-falls/types';

export const collections = {
  blog: defineCollection({
    loader: glob({ pattern: "*.mdx", base: "./src/content/blog" }),
    schema: blogSchema,
  }),
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        character: CharacterSchema.partial().optional(),
        event: EventSchema.partial().optional(),
        location: LocationSchema.partial().optional(),
      })
    }),
  }),
};
