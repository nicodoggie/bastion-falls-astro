import { z } from 'zod';

export const LocationDetailsSchema = z.object({
  population: z.string().optional(),
  area: z.string().optional(),
  notable: z.string().optional(),
});

export const LocationMetadataSchema = z.object({
  details: LocationDetailsSchema.optional(),
});

export const LocationSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    location: LocationMetadataSchema.optional(),
  }).optional(),
});

export type Location = z.infer<typeof LocationSchema>;
