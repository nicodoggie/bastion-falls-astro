import { z } from 'zod';

const EthnicityFrontmatterSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    ethnicity: z.object({
      population: z.string().optional(),
      homeland: z.string().optional(),
      languages: z.array(z.string()).optional(),
      religions: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export type EthnicityFrontmatter = z.infer<typeof EthnicityFrontmatterSchema>;
