import { z } from 'zod';

const ConceptFrontmatterSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    concept: z.object({
      category: z.string().optional(),
      related_concepts: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export type ConceptFrontmatter = z.infer<typeof ConceptFrontmatterSchema>;
