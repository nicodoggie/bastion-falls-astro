import { z } from 'zod';
import { ImageSchema } from './Image.js';

export const SpeciesSchema = z.object({
  name: z.string(),
  image: ImageSchema.optional(),
  type: z.string().optional(),
  origin: z.string().optional(),
  locations: z.array(z.string()).optional(),
  lifespan: z.string().optional(),
  biomes: z.array(z.enum([
    'arctic',
    'coastal',
    'desert',
    'forest',
    'grassland',
    'hill',
    'mountain',
    'swamp',    
    'underdark',
    'underwater',
    'urban'
  ])).optional(),
  traits: z.array(z.string()).optional(),
  diet: z.array(z.string()).optional(),
});

export const SubspeciesSchema = SpeciesSchema.extend({
  parent: z.string().or(z.array(z.string())),
});

export const SpeciesGroupSchema = SpeciesSchema.extend({
  subspecies: z.array(SubspeciesSchema),
});

export type Species = z.infer<typeof SpeciesSchema>;
export type Subspecies = z.infer<typeof SubspeciesSchema>;
export type SpeciesGroup = z.infer<typeof SpeciesGroupSchema>;