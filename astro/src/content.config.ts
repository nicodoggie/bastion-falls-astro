import { defineCollection, z, type SchemaContext, type BaseSchema } from "astro:content";
import type { Image } from "astro:assets";
import { glob } from "astro/loaders";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { autoSidebarLoader } from "starlight-auto-sidebar/loader";
import { autoSidebarSchema } from "starlight-auto-sidebar/schema";

import {
  CharacterSchema,
  ConceptSchema,
  EventSchema,
  FamilySchema,
  LocationSchema,
  SpeciesSchema,
  OrganizationSchema,
  ItemSchema,
} from '@bastion-falls/types';

const baseBlogSchema = z.object({
  title: z.string(),
  draft: z.boolean().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const blogSchema = (context: SchemaContext) => {
  const { image } = context;
  return z.discriminatedUnion(
    'draft',
    [
      baseBlogSchema.extend({
        draft: z.literal(false),
        published: z.date(),
        updated: z.date().optional(),
        banner: z.object({
          url: image(),
          alt: z.string().optional(),
        }).optional(),
      }),
      baseBlogSchema.extend({
        draft: z.undefined(),
        published: z.date(),
        updated: z.date().optional(),
        banner: z.object({
          url: image(),
          alt: z.string().optional(),
        }).optional(),
      }),
      baseBlogSchema.extend({
        draft: z.literal(true),
        banner: z.object({
          url: image(),
          alt: z.string().optional(),
        }).optional(),
      }),
    ]
  );
};

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        character: CharacterSchema.partial().optional(),
        concept: ConceptSchema.partial().optional(),
        event: EventSchema.partial().optional(),
        family: FamilySchema.partial().optional(),
        item: ItemSchema.partial().optional(),
        location: LocationSchema.optional(),
        organization: OrganizationSchema.partial().optional(),
        species: SpeciesSchema.partial().optional(),
      })
    }),
  }),
  autoSidebar: defineCollection({
    loader: autoSidebarLoader(),
    schema: autoSidebarSchema(),
  }),
  character: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/world/characters' }),
    schema: docsSchema({
      extend: z.object({
        character: CharacterSchema.omit({ name: true }).optional(),
      })
    }),
  }),
  family: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/world/families' }), 
    schema: docsSchema({
      extend: z.object({
        family: FamilySchema.optional(),
      })
    }),
  }),
  item: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/world/items' }),
    schema: docsSchema({
      extend: z.object({
        item: ItemSchema.optional(),
      })
    }),
  }),
  location: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/world/locations' }),
    schema: docsSchema({
      extend: z.object({
        location: LocationSchema.optional(),
      })
    }),
  }),
  organization: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/world/organizations' }),
    schema: docsSchema({
      extend: z.object({
        organization: OrganizationSchema.optional(),
      })
    }),
  }),
  species: defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/docs/world/species' }),
    schema: docsSchema({
      extend: z.object({
        species: SpeciesSchema.omit({ name: true }).optional(),
      })
    }),
  }),
  posts: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
    schema: blogSchema,
  }),
};
