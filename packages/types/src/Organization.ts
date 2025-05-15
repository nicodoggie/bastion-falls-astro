import { z } from 'zod';

const OrganizationTypeSchema = z.enum([
  'revolutionary',
  'political',
  'religious',
  'economic',
  'cultural',
  'social',
  'government',
  'military',
  'paramilitary',
  'guild',
  'mercantile',
  'maritime',
  'academic',
]);

const OrganizationSchema = z.object({
  name: z.string(),
  type: OrganizationTypeSchema.or(z.string()),
  founded: z.string().optional(),
  dissolved: z.string().optional(),
  headquarters: z.string().optional(),
  members: z.array(z.string()).optional(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
