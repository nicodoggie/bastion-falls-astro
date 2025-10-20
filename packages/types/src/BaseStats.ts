import { z } from "zod";

export const BaseStatsSchema = z.object({
  size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]),
  strength: z.number(),
  dexterity: z.number(),
  constitution: z.number(),
  intelligence: z.number(),
  wisdom: z.number(),
  charisma: z.number(),
})

export type BaseStats = z.infer<typeof BaseStatsSchema>;