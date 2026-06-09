import { z } from 'zod';
import { ImageSchema } from './Image.js';

export const FamilySchema = z.object({
  name: z.string(),
  image: ImageSchema.or(ImageSchema.array()).optional(),
  founded: z.string().optional(),
  dissolved: z.string().optional(),
  seat: z.string().optional(),
  motto: z.string().optional(),
});

export type Family = z.infer<typeof FamilySchema>;
