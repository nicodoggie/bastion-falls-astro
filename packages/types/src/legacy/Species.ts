import { z } from 'zod';

export const SpeciesSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    species: z.object({
      type: z.string().optional(),
      origin: z.string().optional(),
      lifespan: z.string().optional(),
      traits: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export type Species = z.infer<typeof SpeciesSchema>;
