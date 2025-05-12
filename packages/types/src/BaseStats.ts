import { z } from "zod";

const SpeedSchema = z.object({
  base: z.number(),
  fly: z.number().optional(),
  swim: z.number().optional(),
  burrow: z.number().optional(),
})

export const BaseStatsSchema = z.object({
  strength: z.number(),
  dexterity: z.number(),
  constitution: z.number(),
  intelligence: z.number(),
  wisdom: z.number(),
  charisma: z.number(),
  speed: SpeedSchema,
})

export type BaseStats = z.infer<typeof BaseStatsSchema>;