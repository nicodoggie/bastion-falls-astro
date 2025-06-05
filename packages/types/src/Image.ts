import { z } from "zod";

export const BaseImageSchema = z.object({
  url: z.string().optional(),
  alt: z.string().optional(),
})

export const ImageAttributionSchema = BaseImageSchema.extend({
  attribution: z.string().optional(),
  attributionUrl: z.string().url().optional(),
})

export const ImagePromptSchema = BaseImageSchema.extend({
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  generatorUrl: z.string().optional(),
  model: z.string().optional(),
})

export const ImageSchema = z.union([ImageAttributionSchema, ImagePromptSchema]);

export type Image = z.infer<typeof ImageSchema>;
export type ImageAttribution = z.infer<typeof ImageAttributionSchema>;
export type ImagePrompt = z.infer<typeof ImagePromptSchema>;
