import { z } from 'zod';

const OrganizationFrontmatterSchema = z.object({
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

export type OrganizationFrontmatter = z.infer<typeof OrganizationFrontmatterSchema>;
