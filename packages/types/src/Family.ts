import { z } from 'zod';
import { ImageSchema } from './Image.js';

export const FamilySchema = z.object({
  name: z.string(),
  founded: z.string().optional(),
  dissolved: z.string().optional(),
  seat: z.string().optional(),
  motto: z.string().optional(),
  sigil: ImageSchema.nullable().optional(),
});

export type Family = z.infer<typeof FamilySchema>;
