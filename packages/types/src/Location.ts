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

export const HeritageLocationTypeSchema = z.enum([
  'ruins',
  'monument',
  'tomb',
  'archaeological site',
  'historical region',
  'historical kingdom',
  'historical city',
]);

const HeritageLocationDetailsSchema = z.object({
  type: HeritageLocationTypeSchema,
  details: z.object({
    timeline: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
    }).optional(),
  }),
});

export const NaturalLocationTypeSchema = z.enum([
  'feature',
  'mountain',
  'forest',
  'island',
  'peninsula',
  'archipelago',
  'atoll',
  'mountain range',
  'gorge',
  'canyon',
  'pass',
  'basin',
  'plains',
  'field',
  'march',
  'isthmus',
  'plane',
]);

const NaturalLocationDetailsSchema = z.object({
  type: NaturalLocationTypeSchema,
  area: z.string().optional(),
  elevation: z.string().optional(),
  climate: z.string().optional(),
});

export const NaturalWaterTypeSchema = z.union([NaturalLocationTypeSchema, z.enum([
  'river',
  'sea',
  'lake',
  'ocean',
  'waterway',
  'gulf',
  'bay',
  'channel',
  'sound',
  'reach',
  'geyser',
  'strait',
  'waterfall',
])]);

export const NaturalWaterLocationDetailsSchema = z.object({
  type: NaturalWaterTypeSchema,
  area: z.string().optional(),
  elevation: z.string().optional(),
  climate: z.string().optional(),
  depth: z.object({
    min: z.string().optional(),
    mean: z.string().optional(),
    max: z.string().optional(),
  }).optional(),
  width: z.object({
    min: z.string().optional(),
    mean: z.string().optional(),
    max: z.string().optional(),
  }).optional(),
  current: z.object({
    min: z.number().optional(),
    mean: z.number().optional(),
    max: z.number().optional(),
  }).optional(), // knots
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
  HeritageLocationDetailsSchema,
]);

export const LocationTypeSchema = z.union([
  PoliticalLocationTypeSchema,
  NaturalLocationTypeSchema,
  BuildingLocationTypeSchema,
  HeritageLocationTypeSchema,
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