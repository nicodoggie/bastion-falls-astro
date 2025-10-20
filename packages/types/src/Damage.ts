import { z } from "zod";

export const PhysicalDamageTypeSchema = z.enum([
  "bludgeoning",
  "piercing",
  "slashing"
]);

export const EnergyDamageTypeSchema = z.enum([
  "acid",
  "cold",
  "fire",
  "lightning",
  "poison",
  "psychic",
  "radiant",
  "thunder",
  "force",
]);

export const DamageTypeSchema = z.union([
  PhysicalDamageTypeSchema,
  EnergyDamageTypeSchema,
]);

export type PhysicalDamageType = z.infer<typeof PhysicalDamageTypeSchema>;
export type EnergyDamageType = z.infer<typeof EnergyDamageTypeSchema>;
export type DamageType = z.infer<typeof DamageTypeSchema>;