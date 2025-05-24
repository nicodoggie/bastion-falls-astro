import { z } from 'zod';

export const ReligionSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    religion: z.object({
      type: z.string().optional(),
      founded: z.string().optional(),
      headquarters: z.string().optional(),
      deities: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export type Religion = z.infer<typeof ReligionSchema>;
