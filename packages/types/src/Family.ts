import { z } from 'zod';

export const FamilySchema = z.object({
  name: z.string(),
  founded: z.string().optional(),
  dissolved: z.string().optional(),
  seat: z.string().optional(),
  motto: z.string().optional(),
  sigil: z.string().optional(),
});

export type Family = z.infer<typeof FamilySchema>;
