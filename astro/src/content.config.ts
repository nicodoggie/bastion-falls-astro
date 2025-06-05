import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { blogSchema } from "./schemas/BlogPost";
import { CharacterSchema, EventSchema, FamilySchema, LocationSchema, SpeciesSchema } from '@bastion-falls/types';
import { OrganizationSchema } from '@bastion-falls/types';

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
        organization: OrganizationSchema.partial().optional(),
      })
    }),
  }),
  character: defineCollection({
    loader: glob({ pattern: "*.mdx", base: "./src/content/docs/characters" }),
    schema: docsSchema({
      extend: z.object({
        character: CharacterSchema,
      })
    }),
  }),
  family: defineCollection({
    loader: glob({
      pattern: ["!index.mdx", "**/*.mdx", "**/index.mdx"],
      base: "./src/content/docs/families"
    }),
    schema: docsSchema({
      extend: z.object({
        family: FamilySchema,
      })
    }),
  }),
  location: defineCollection({
    loader: glob({
      pattern: ["*.mdx"],
      base: "./src/content/docs/locations"
    }),
    schema: docsSchema({
      extend: z.object({
        location: LocationSchema,
      })
    }),
  }),
  organization: defineCollection({
    loader: glob({
      pattern: ["*.mdx"],
      base: "./src/content/docs/organizations"
    }),
    schema: docsSchema({
      extend: z.object({
        organization: OrganizationSchema,
      })
    }),
  }),
  species: defineCollection({
    loader: glob({ pattern: "*.mdx", base: "./src/content/docs/species" }),
    schema: docsSchema({
      extend: z.object({
        species: SpeciesSchema,
      })
    }),
  }),
};
