import { z } from 'zod';
import { ImageSchema } from './Image.js';

export const SpeciesSchema = z.object({
  name: z.string(),
  image: ImageSchema.optional(),
  type: z.string().optional(),
  origin: z.string().optional(),
  locations: z.array(z.string()).optional(),
  lifespan: z.string().optional(),
  biomes: z.array(z.string()).optional(),
  traits: z.array(z.string()).optional(),
  diet: z.array(z.string()).optional(),
});

export type Species = z.infer<typeof SpeciesSchema>;