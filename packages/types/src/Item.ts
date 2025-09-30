import { z } from 'zod';
import { ImageSchema } from './Image.js';

export const ItemSchema = z.object({
  name: z.string().optional(),
  image: ImageSchema.optional(),
  ddb: z.string().url().optional(),
  details: z.object({
    attunement: z.boolean().optional(),
    type: z.string().optional(),
    rarity: z.string().optional(),
    weight: z.string().optional(),
    value: z.string().optional(),
  }).optional(),
});

export type Item = z.infer<typeof ItemSchema>;