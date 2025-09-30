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

const OrganizationMemberPositionsHeldSchema = z.object({
  name: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const OrganizationMemberSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
});

export const OrganizationSchema = z.object({
  name: z.string().optional(),
  type: OrganizationTypeSchema.or(z.string()).optional(),
  founded: z.string().optional(),
  dissolved: z.string().optional(),
  headquarters: z.string().optional(),
  members: z.array(OrganizationMemberSchema).optional(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
