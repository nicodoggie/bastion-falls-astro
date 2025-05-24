import { z } from 'zod';

export const ConceptSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    concept: z.object({
      category: z.string().optional(),
      related_concepts: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export type Concept = z.infer<typeof ConceptSchema>;
