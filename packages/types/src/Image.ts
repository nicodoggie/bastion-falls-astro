import { z } from "zod";

export const ImageSchema = z.object({
  url: z.string().optional(),
})

export const ImageAttributionSchema = ImageSchema.extend({
  attribution: z.string().optional(),
  attributionUrl: z.string().url().optional(),
})

export const ImagePromptSchema = ImageSchema.extend({
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  generatorUrl: z.string().optional(),
  model: z.string().optional(),
})

export type Image = z.infer<typeof ImageSchema>;
export type ImageAttribution = z.infer<typeof ImageAttributionSchema>;
export type ImagePrompt = z.infer<typeof ImagePromptSchema>;
