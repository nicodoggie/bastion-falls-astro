import { z } from 'zod';

const CharacterImageSchema = z.object({
  url: z.string(),
  attribution: z.string().optional(),
  attribution_url: z.string().optional(),
  prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
});

const CharacterMetadataSchema = z.object({
  age: z.string().or(z.number()),
  date_of_birth: z.string().optional(),
  date_of_death: z.string().optional(),
  sex: z.string().optional(),
  pronouns: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  alias: z.string().optional(),
  mortality_status: z.string().optional(),
  height: z.string().optional(),
  weight: z.string().optional(),
  position: z.string().optional(),
  species: z.string().optional(),
  penis_length: z.string().optional(),
  penis_girth: z.string().optional(),
});

const CharacterFrontmatterSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    ddb: z.string().optional(),
    image: CharacterImageSchema.optional(),
    character: CharacterMetadataSchema.optional(),
    mortality_status: z.string().optional(),
  }).optional(),
});

export type CharacterFrontmatter = z.infer<typeof CharacterFrontmatterSchema>;
