import { z } from 'zod';
import { ImageSchema } from './Image.js';

const LocationDetailsSchema = z.object({
  population: z.string().optional(),
  area: z.string().optional(),
})

const LocationSectionSchema = LocationDetailsSchema.extend({
  name: z.string(),
  description: z.string().optional(),
})

export const LocationSchema = z.object({
  name: z.string(),
  image: ImageSchema,
  details: LocationDetailsSchema,
  sections: z.array(LocationSectionSchema),
  parents: z.array(z.string()),
  related: z.array(z.string()),
})

export type Location = z.infer<typeof LocationSchema>;