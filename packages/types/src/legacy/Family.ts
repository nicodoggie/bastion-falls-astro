import { z } from 'zod';

export const FamilySchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    family: z.object({
      founded: z.string().optional(),
      dissolved: z.string().optional(),
      seat: z.string().optional(),
      motto: z.string().optional(),
      sigil: z.string().optional(),
    }).optional(),
  }).optional(),
});

export type Family = z.infer<typeof FamilySchema>;
