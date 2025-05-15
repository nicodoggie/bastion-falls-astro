import { z } from 'zod';

const SpeciesFrontmatterSchema = z.object({
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

export type SpeciesFrontmatter = z.infer<typeof SpeciesFrontmatterSchema>;
