import { z } from 'zod';
import { BaseFrontmatterSchema } from '../BaseFrontmatter.js';

export const CharacterImageSchema = z.object({
  url: z.string().nullish(),
});

export const CharacterImageAttributionSchema = CharacterImageSchema.extend({
  attribution: z.string().nullish(),
  attribution_url: z.string().nullish(),
});
export const CharacterPromptSchema = CharacterImageSchema.extend({
  prompt: z.string().nullish(),
  negative_prompt: z.string().nullish(),
});

export const CharacterMetadataSchema = z.object({
  age: z.string().or(z.number()).nullish(),
  date_of_birth: z.string().nullish(),
  date_of_death: z.string().nullish(),
  sex: z.string().nullish(),
  pronouns: z.string().nullish(),
  aliases: z.array(z.string()).nullish(),
  alias: z.string().nullish(),
  mortality_status: z.string().nullish(),
  height: z.string().nullish(),
  weight: z.string().nullish(),
  position: z.string().nullish(),
  species: z.string().nullish(),
  penis_length: z.string().nullish(),
  penis_girth: z.string().nullish(),
});

export const CharacterSchema = BaseFrontmatterSchema.extend({
  extraMetadata: z.object({
    ddb: z.string().nullish(),
    image: CharacterImageAttributionSchema.or(CharacterPromptSchema).nullish(),
    character: CharacterMetadataSchema.nullish(),
    mortality_status: z.string().nullish(),
  }).nullish(),
});

export type CharacterImageAttribution = z.infer<typeof CharacterImageAttributionSchema>;
export type CharacterPrompt = z.infer<typeof CharacterPromptSchema>;
export type CharacterImage = z.infer<typeof CharacterImageSchema>;
export type CharacterMetadata = z.infer<typeof CharacterMetadataSchema>;
export type Character = z.infer<typeof CharacterSchema>;
