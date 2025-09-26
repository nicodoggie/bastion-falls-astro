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
    schema: docsSchema({
      extend: z.object({
        character: CharacterSchema,
      })
    }),
  }),
  family: defineCollection({
    schema: docsSchema({
      extend: z.object({
        family: FamilySchema,
      })
    }),
  }),
  location: defineCollection({
    schema: docsSchema({
      extend: z.object({
        location: LocationSchema,
      })
    }),
  }),
  organization: defineCollection({
    schema: docsSchema({
      extend: z.object({
        organization: OrganizationSchema,
      })
    }),
  }),
  species: defineCollection({
    schema: docsSchema({
      extend: z.object({
        species: SpeciesSchema.omit({ name: true }),
      })
    }),
  }),
};
