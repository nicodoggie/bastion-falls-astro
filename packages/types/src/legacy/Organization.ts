import { z } from 'zod';

const OrganizationTypeLegacyEnum = z.enum([
  'revolutionary',
  'political',
  'religious',
  'economic',
  'cultural',
  'social',
  'Religion',
  'Religious Society',
  'Government',
  'State Legislature',
  'Mercenary Group',
  'Guild',
  'Gang',
  'Society',
  'Business Entity',
  'Ship',
]);

export const OrganizationSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    organization: z.object({
      type: z.string().optional(),
      founded: z.string().optional(),
      dissolved: z.string().optional(),
      headquarters: z.string().optional(),
    }).optional(),
  }).optional(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
