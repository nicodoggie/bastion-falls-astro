/**
 * Single source of truth for per-collection Zod extension schemas.
 *
 * This file is intentionally free of astro:content / astro/zod imports so
 * it can be imported from any context:
 *   - astro/src/content.config.ts  (passed as `extend:` to docsSchema())
 *   - astro/src/integrations/vscode-frontmatter-schemas.ts
 *     (called with .toJSONSchema() to generate YAML IntelliSense schemas)
 */
import { z } from 'astro/zod';

import { CreatureDataSchema, VehicleShipDataSchema } from '@bastion-falls/5e-schema-zod';
import {
  CharacterSchema,
  ConceptSchema,
  EventSchema,
  FamilySchema,
  ItemSchema,
  LocationSchema,
  OrganizationSchema,
  ReligionSchema,
  SpeciesSchema,
} from '@bastion-falls/types';

/**
 * Extension schemas for each dedicated world collection.
 * Each value is the object passed as `extend:` inside `docsSchema()`.
 *
 * Adding a field here automatically:
 *   1. Validates it in the Astro content collection (via content.config.ts)
 *   2. Generates a matching JSON Schema for YAML IntelliSense
 *      (via the vscode-frontmatter-schemas integration)
 */
export const collectionExtensions = {
  character: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/characters',
    },
    schema:
      z.object({
        character: CharacterSchema.omit({ name: true }).optional(),
        creatureStats: z.record(
          z.string(), 
          CreatureDataSchema.or(z.string())
        ).optional()
      }),
  },

  concept: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/concepts',
    },
    schema: z.object({
      concept: ConceptSchema.optional(),
    }),
  },

  event: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/events',
    },
    schema: z.object({
      event: EventSchema.omit({ name: true }).optional(),
    }),
  },

  family: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/families',
    },
    schema: z.object({
      family: FamilySchema.optional(),
    }),
  },

  item: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/items',
    },
    schema: z.object({
      item: ItemSchema.optional(),
    }),
  },

  location: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/locations',
    },
    schema: z.object({
      location: LocationSchema.optional(),
    }),
  },

  organization: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/organizations',
    },
    schema: z.object({
      organization: OrganizationSchema.optional(),
    }),
  },

  religion: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/organizations',
    },
    schema: z.object({
      religion: ReligionSchema.optional(),
    }),
  },

  species: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/species',
    },
    schema: z.object({
      species: SpeciesSchema.omit({ name: true }).optional(),
      creatureStats: z.record(
        z.string(), 
        CreatureDataSchema.or(z.string())
      ).optional(),
    }),
  },

  vehicle: {
    loader: {
      pattern: '**/*.mdx',
      base: './src/content/docs/world/vehicles',
    },
    schema: z.object({
      vehicle: VehicleShipDataSchema.optional(),
    }),
  },
} as const;

export type CollectionName = keyof typeof collectionExtensions;

/**
 * Merged extension for the catch-all `docs` collection.
 * Every field from every per-collection schema, all optional, so any page
 * can carry any custom field without being in a specific sub-collection.
 */
const TimelineOverrideSchema = z.object({
  label: z.string().optional(),
  year: z.string().optional(),
  type: z.enum(['birth', 'death', 'start', 'end', 'discover']).optional(),
  priority: z.number().optional(),
  order: z.number().optional(),
});

const TimelineFieldSchema = z.union([
  z.boolean(),
  TimelineOverrideSchema,
  z.array(TimelineOverrideSchema),
]);

export const docsExtension = z.object(
  Object.fromEntries(
    Object.values(collectionExtensions).flatMap(({ schema }) =>
      Object.entries(schema.shape as Record<string, z.ZodTypeAny>)
    )
  )
).extend({
  timeline: TimelineFieldSchema.optional(),
});
