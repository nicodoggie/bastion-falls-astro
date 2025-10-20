import { z } from "zod";

export const SpeedSchema = z.object({
  base: z.number().optional().default(0), // feet
  fly: z.number().optional(),
  swim: z.number().optional(),
  burrow: z.number().optional(),
  special: z.string().optional(),
});

export type Speed = z.infer<typeof SpeedSchema>;