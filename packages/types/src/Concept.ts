import { z } from 'zod';
import { ImageSchema } from './Image.js';

export const ConceptSchema = z.object({
  title: z.string(),
  image: ImageSchema.or(ImageSchema.array()).optional(),
  tags: z.array(z.string()),
  concept: z.object({
    category: z.string().optional(),
    related_concepts: z.array(z.string()).optional(),
  }).optional(),
});

export type Concept = z.infer<typeof ConceptSchema>;
