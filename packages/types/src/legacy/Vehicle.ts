import { z } from 'zod';

const VehicleFrontmatterSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    vehicle: z.object({
      type: z.string().optional(),
      crew: z.string().optional(),
      capacity: z.string().optional(),
      speed: z.string().optional(),
    }).optional(),
  }).optional(),
});

export type VehicleFrontmatter = z.infer<typeof VehicleFrontmatterSchema>;
