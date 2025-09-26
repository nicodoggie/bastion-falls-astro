import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { BlogSchema } from "./schemas/BlogPost";
import {
  CharacterSchema,
  ConceptSchema,
  EventSchema,
  FamilySchema,
  LocationSchema,
  SpeciesSchema,
  OrganizationSchema,
} from '@bastion-falls/types';
import { glob } from "astro/loaders";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        character: CharacterSchema.partial().optional(),
        concept: ConceptSchema.partial().optional(),
        event: EventSchema.partial().optional(),
        family: FamilySchema.partial().optional(),
        location: LocationSchema.optional(),
        organization: OrganizationSchema.partial().optional(),
        species: SpeciesSchema.partial().optional(),
      })
    }),
  }),
  character: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/characters' }),
    schema: docsSchema({
      extend: z.object({
        character: CharacterSchema.omit({ name: true }).optional(),
      })
    }),
  }),
  family: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/families' }), 
    schema: docsSchema({
      extend: z.object({
        family: FamilySchema.optional(),
      })
    }),
  }),
  location: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/locations' }),
    schema: docsSchema({
      extend: z.object({
        location: LocationSchema.optional(),
      })
    }),
  }),
  organization: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/organizations' }),
    schema: docsSchema({
      extend: z.object({
        organization: OrganizationSchema.optional(),
      })
    }),
  }),
  species: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/species' }),
    schema: docsSchema({
      extend: z.object({
        species: SpeciesSchema.omit({ name: true }).optional(),
      })
    }),
  }),
};
