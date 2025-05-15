import { z } from 'zod';

const LocationDetailsSchema = z.object({
  population: z.string().optional(),
  area: z.string().optional(),
  notable: z.string().optional(),
});

const LocationMetadataSchema = z.object({
  details: LocationDetailsSchema.optional(),
});

const LocationFrontmatterSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    location: LocationMetadataSchema.optional(),
  }).optional(),
});

export type LocationFrontmatter = z.infer<typeof LocationFrontmatterSchema>;
