import { z } from "zod";
import { BaseStatsSchema } from "./BaseStats.js";
import { ImageAttributionSchema, ImageGenerationSchema } from "./Image.js";

const AlignmentSchema = z.object({
  moral: z.enum(["lawful", "neutral", "chaotic"]),
  law: z.enum(["good", "neutral", "evil"]),
})

const CharacterBackgroundSchema = z.object({
  alignment: AlignmentSchema.optional(),
  background: z.string().optional(),
  goals: z.string().optional(),
  flaws: z.string().optional(),
  backstory: z.string().optional(),
})

const CharacterDetailsSchema = z.object({
  age: z.number().optional(),
  aliases: z.array(z.string()).optional(),
  dateOfBirth: z.string().optional(),
  dateOfDeath: z.string().optional(),
  sex: z.string().optional(),
  pronouns: z.string().optional(),
  height: z.string().optional(),
  weight: z.string().optional(),
  origin: z.string().optional(),
})

const CharacterRelationshipsSchema = z.object({
  organizations: z.array(z.string()).optional(),
  parents: z.array(z.string()).optional(),
  siblings: z.array(z.string()).optional(),
  children: z.array(z.string()).optional(),
  partners: z.array(z.string()).optional(),
  friends: z.array(z.string()).optional(),
  enemies: z.array(z.string()).optional(),
  allies: z.array(z.string()).optional(),
  others: z.array(z.string()).optional(),
})

export const CharacterSchema = z.object({
  name: z.string(),
  ddb: z.string().url().optional(),
  image: z.union([ImageAttributionSchema, ImageGenerationSchema]).optional(),
  stats: BaseStatsSchema,
  background: CharacterBackgroundSchema.optional(),
  details: CharacterDetailsSchema.optional(),
  relationships: CharacterRelationshipsSchema.optional(),
})

export type Character = z.infer<typeof CharacterSchema>;