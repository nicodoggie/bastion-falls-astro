import { z } from 'zod';
import { BaseImageSchema } from './Image.js';

const LocationDetailsSchema = z.object({
  population: z.string().optional(),
  area: z.string().optional(),
})

const LocationType = z.enum([
  'city',
  'town',
  'village',
  'settlement',
  'township',
  'port',
  'fortress',
  'region',
  'country',
  'kingdom',
  'empire',
  'principality',
  'continent',
  'world',
  'state',
  'freehold',
  'province',
  'duchy',
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
]);

const LocationSectionSchema = LocationDetailsSchema.extend({
  name: z.string(),
  description: z.string().optional(),
})

export const LocationSchema = z.object({
  name: z.string(),
  type: LocationType.or(z.string()).optional(),
  image: BaseImageSchema.optional(),
  details: LocationDetailsSchema.optional(),
  sections: z.array(LocationSectionSchema).optional(),
  parents: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
})

export type Location = z.infer<typeof LocationSchema>;