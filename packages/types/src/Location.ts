import { z } from 'zod';
import { BaseImageSchema } from './Image.js';


export const PoliticalLocationTypeSchema = z.enum([
  'capital',
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
  'corridor',
  'fort',
])

export const HeritageLocationTypeSchema = z.enum([
  'ruins',
  'monument',
  'tomb',
  'archaeological site',
  'historical region',
  'historical kingdom',
  'historical city',
]);

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
  'cave',
  'bog',
]);

export const NaturalWaterLocationTypeSchema = z.enum([
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
  'geyser field',
  'strait',
  'waterfall',
]);

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
]);

export const LocationTypeSchema = z.union([
  PoliticalLocationTypeSchema,
  NaturalLocationTypeSchema,
  NaturalWaterLocationTypeSchema,
  BuildingLocationTypeSchema,
  HeritageLocationTypeSchema,
]);

export const BaseLocationSchema = z.object({
  type: LocationTypeSchema,
  image: BaseImageSchema.optional(),
  parents: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  details: z.record(z.string(), z.string()).optional(),
});

const PoliticalLocationSchema = BaseLocationSchema.extend({
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
    }).optional(),
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
  }).optional(),
})

const HeritageLocationSchema = BaseLocationSchema.extend({
  type: HeritageLocationTypeSchema,
  details: z.object({
    timeline: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
    }).optional(),
  }).optional(),
});

const NaturalLocationSchema = BaseLocationSchema.extend({
  type: NaturalLocationTypeSchema,
  details: z.object({
    area: z.string().optional(),
    elevation: z.string().optional(),
    climate: z.string().optional(),
  }).optional(),
});

const BuildingLocationSchema = BaseLocationSchema.extend({
  type: BuildingLocationTypeSchema,
  details: z.object({
    owner: z.string().optional(),
    area: z.string().optional(),
  }).optional(),
});

export const NaturalWaterLocationSchema = NaturalLocationSchema.extend({
  type: NaturalWaterLocationTypeSchema,
  details: z.object({
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
  }).optional(),
});

export const LocationSchema = z.discriminatedUnion('type', [
  PoliticalLocationSchema,
  HeritageLocationSchema,
  NaturalLocationSchema,
  BuildingLocationSchema,
  NaturalWaterLocationSchema,
]);

export type Location = z.infer<typeof LocationSchema>;
export type BuildingLocationType = z.infer<typeof BuildingLocationTypeSchema>;
export type PoliticalLocationType = z.infer<typeof PoliticalLocationTypeSchema>;
export type NaturalLocationType = z.infer<typeof NaturalLocationTypeSchema>;
export type NaturalWaterLocationType = z.infer<typeof NaturalWaterLocationTypeSchema>;
export type HeritageLocationType = z.infer<typeof HeritageLocationTypeSchema>;
export type LocationType = z.infer<typeof LocationTypeSchema>;
export type BuildingLocation = z.infer<typeof BuildingLocationSchema>;
export type PoliticalLocation = z.infer<typeof PoliticalLocationSchema>;
export type NaturalLocation = z.infer<typeof NaturalLocationSchema>;
export type NaturalWaterLocation = z.infer<typeof NaturalWaterLocationSchema>;
export type HeritageLocation = z.infer<typeof HeritageLocationSchema>;