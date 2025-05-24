import { z } from 'zod';

export const ItemSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    item: z.object({
      type: z.string().optional(),
      rarity: z.string().optional(),
      value: z.string().optional(),
      weight: z.string().optional(),
    }).optional(),
  }).optional(),
});

export type Item = z.infer<typeof ItemSchema>;
