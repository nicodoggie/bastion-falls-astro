import { z } from 'zod';
import { BaseImageSchema } from './Image.js';


export const PoliticalLocationTypeSchema = z.enum([
  'city',
  'confederacy',
  'continent',
  'country',
  'diocese',
  'duchy',
  'empire',
  'fortress',
  'freehold',
  'kingdom',
  'marquessate',
  'county',
  'earldom',
  'port',
  'principality',
  'protectorate',
  'province',
  'region',
  'settlement',
  'state',
  'territory',
  'town',
  'township',
  'village',
  'world',
])

const PoliticalLocationDetailsSchema = z.object({
  type: PoliticalLocationTypeSchema,
  details: z.object({
    flag: BaseImageSchema.optional(),
    map: BaseImageSchema.optional(),
    motto: z.string().optional(),
    anthem: z.string().optional(),
    capital: z.string().optional(),
    government: z.object({
      type: z.string().optional(),
      structure: z.record(z.string(), z.string()).optional(),
    }),
    currency: z.string().optional(),
    religions: z.array(z.string()).optional(),
    states: z.array(z.string()).optional(),
    population: z.string().optional(),
    area: z.string().optional(),
    elevation: z.string().optional(),
    climate: z.string().optional(),
    sections: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      area: z.string().optional(),
      population: z.string().optional(),
    })).optional(),
  }),
})

export const NaturalLocationTypeSchema = z.enum([
  'feature',
  'river',
  'sea',
  'mountain',
  'forest',
  'waterway',
  'strait',
  'island',
  'peninsula',
  'archipelago',
  'waterfall',
  'gulf',
  'bay',
  'channel',
  'sound',
  'reach',
  'atoll',
  'geyser',
  'mountain range',
  'gorge',
  'canyon',
  'pass',
  'basin',
  'plains',
  'field',
  'march',
  'lake',
  'isthmus',
]);

const NaturalLocationDetailsSchema = z.object({
  type: NaturalLocationTypeSchema,
  area: z.string().optional(),
  elevation: z.string().optional(),
  climate: z.string().optional(),
});

export const BuildingLocationTypeSchema = z.enum([
  'office',
  'shack',
  'mine',
  'inn',
  'brothel',
  'restaurant',
  'academy',
  'cathedral',
  'church',
  'temple',
  'court',
  'palace',
  'manor',
  'mansion',
  'homestead',
  'farm',
  'orphanage',
  'compound',
  'residence',
  'lighthouse',
  'headquarters',
  'library',
  'fortress',
]);

const BuildingLocationDetailsSchema = z.object({
  type: BuildingLocationTypeSchema,
  details: z.object({
    owner: z.string().optional(),
    area: z.string().optional(),
  }),
});

const LocationDetailsSchema = z.discriminatedUnion('type', [
  PoliticalLocationDetailsSchema,
  NaturalLocationDetailsSchema,
  BuildingLocationDetailsSchema,
]);

export const LocationTypeSchema = z.union([
  PoliticalLocationTypeSchema,
  NaturalLocationTypeSchema,
  BuildingLocationTypeSchema,
]);

export const LocationSchema = z.object({
  name: z.string(),
  type: LocationTypeSchema,
  image: BaseImageSchema.optional(),
  parents: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
}).extend({
  details: LocationDetailsSchema.optional(),
})

export type Location = z.infer<typeof LocationSchema>;
export type BuildingLocationType = z.infer<typeof BuildingLocationTypeSchema>;
export type PoliticalLocationType = z.infer<typeof PoliticalLocationTypeSchema>;
export type NaturalLocationType = z.infer<typeof NaturalLocationTypeSchema>;
export type LocationType = z.infer<typeof LocationTypeSchema>;
export type BuildingLocationDetails = z.infer<typeof BuildingLocationDetailsSchema>;
export type PoliticalLocationDetails = z.infer<typeof PoliticalLocationDetailsSchema>;
export type NaturalLocationDetails = z.infer<typeof NaturalLocationDetailsSchema>;
export type LocationDetails = z.infer<typeof LocationDetailsSchema>;