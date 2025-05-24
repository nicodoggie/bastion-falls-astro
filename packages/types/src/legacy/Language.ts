import { z } from 'zod';

export const LanguageSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    language: z.object({
      type: z.string().optional(),
      script: z.string().optional(),
      speakers: z.string().optional(),
      related_languages: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export type Language = z.infer<typeof LanguageSchema>;
