import { z } from "zod";
import { BaseStatsSchema } from "./BaseStats.js";
import { SpeedSchema } from "./Speed.js";
import { DamageTypeSchema } from "./Damage.js";

export const VehicleTypeSchema = z.enum(["land", "air", "sea"]);

export const CapacitySchema = z.object({
  crew: z.number(),
  passengers: z.number().optional(),
  cargo: z.number().optional(),
})

export const VehicleCrewSchema = z.object({
  name: z.string(),
  position: z.string(),
})

const RangeBoundsSchema = z.object({
  min: z.number(),
  max: z.number(),
})

export const ActionSchema = z.object({
  type: z.string(),
  range: z.number().or(RangeBoundsSchema),
  damage: z.object({
    type: DamageTypeSchema,
    toHit: z.number(),
    amount: z.string(),
  }),
  description: z.string().optional(),
})

export const VehicleSectionSchema = z.object({
  name: z.string(),
  armorClass: z.number(),
  hitPoints: z.object({
    base: z.number(),
    damageThreshold: z.number().optional(),
    special: z.string().optional(),
  }),
  speed: SpeedSchema.optional(),
  count: z.number().optional().default(1),
  description: z.string().optional(),
  actions: z.array(ActionSchema).optional(),
})

export const VehicleSchema = z.object({
  name: z.string(),
  type: z.string(),
  stats: BaseStatsSchema,
  travelPace: z.number(), // miles per hour
  capacity: CapacitySchema,
  crew: z.array(VehicleCrewSchema),
  sections: z.array(VehicleSectionSchema),
});

export type Vehicle = z.infer<typeof VehicleSchema>;