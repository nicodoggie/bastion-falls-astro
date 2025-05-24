import { z } from "zod";
import { BaseStatsSchema } from "./BaseStats.js";
import { ImageAttributionSchema, ImagePromptSchema } from "./Image.js";

const AlignmentSchema = z.object({
  moral: z.enum(["lawful", "neutral", "chaotic"]),
  law: z.enum(["good", "neutral", "evil"]),
})

const MortalityEnum = z.enum(["alive", "dead", "undead", "unknown"]);


const SexOrganTypeSchema = z.object({
  type: z.enum(["penis", "vagina", "breasts", "unknown"]),
})

const PubicHairSchema = z.enum(["none", "trimmed", "full"]);

const PenisSchema = SexOrganTypeSchema.extend({
  type: z.literal("penis"),
  length: z.number().optional(),
  girth: z.number().optional(),
  pubicHair: PubicHairSchema.optional(),
})

const VaginaSchema = SexOrganTypeSchema.extend({
  type: z.literal("vagina"),
  depth: z.number().optional(),
  width: z.number().optional(),
  pubicHair: PubicHairSchema.optional(),
})

const BreastSchema = SexOrganTypeSchema.extend({
  type: z.literal("breasts"),
  size: z.enum(["flat", "small", "medium", "large", "huge", "gigantic"]).optional(),
  nipples: z.enum(["inverted", "normal", "outie"]).optional(),
})

const SexOrganSchema = z.discriminatedUnion("type", [PenisSchema, VaginaSchema, BreastSchema]);

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
  mortality: MortalityEnum.optional(),
  species: z.string().optional(),
  sexOrgans: z.array(SexOrganSchema).optional(),
})

const CharacterOrganizationSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
})

export const CharacterRelativeSchema = z.object({
  name: z.string(),
  type: z.enum(["parent", "sibling", "child", "partner", "friend", "enemy", "ally", "other"]),
});

export const CharacterReligionSchema = z.object({
  name: z.string(),
})

export const CharacterFamilySchema = z.object({
  name: z.string(),
})

export const CharacterRelationshipsSchema = z.object({
  organizations: z.array(CharacterOrganizationSchema).optional(),
  relatives: z.array(CharacterRelativeSchema).optional(),
  religions: z.array(CharacterReligionSchema).optional(),
  families: z.array(CharacterFamilySchema).optional(),
})

export const CharacterSchema = z.object({
  name: z.string(),
  ddb: z.string().url().optional(),
  image: ImageAttributionSchema.or(ImagePromptSchema).optional(),
  stats: BaseStatsSchema.optional(),
  background: CharacterBackgroundSchema.optional(),
  details: CharacterDetailsSchema.optional(),
  relationships: CharacterRelationshipsSchema.optional(),
})

export type CharacterRelative = z.infer<typeof CharacterRelativeSchema>;
export type CharacterReligion = z.infer<typeof CharacterReligionSchema>;
export type CharacterOrganization = z.infer<typeof CharacterOrganizationSchema>;
export type CharacterSexOrgan = z.infer<typeof SexOrganSchema>;
export type CharacterDetails = z.infer<typeof CharacterDetailsSchema>;
export type CharacterBackground = z.infer<typeof CharacterBackgroundSchema>;
export type CharacterRelationships = z.infer<typeof CharacterRelationshipsSchema>;
export type CharacterFamily = z.infer<typeof CharacterFamilySchema>;
export type Character = z.infer<typeof CharacterSchema>;
export default CharacterSchema;