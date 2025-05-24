import { z } from 'zod';

export const VehicleSchema = z.object({
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

export type Vehicle = z.infer<typeof VehicleSchema>;
