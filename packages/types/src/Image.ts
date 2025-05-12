import { z } from "zod";

export const ImageSchema = z.object({
  url: z.string().url(),
})

export const ImageAttributionSchema = ImageSchema.extend({
  attribution: z.string(),
  attributionUrl: z.string().url(),
})

export const ImageGenerationSchema = ImageSchema.extend({
  prompt: z.string(),
  generatorUrl: z.string().url().optional(),
  model: z.string().optional(),
})

export type Image = z.infer<typeof ImageSchema>;
export type ImageAttribution = z.infer<typeof ImageAttributionSchema>;
export type ImageGeneration = z.infer<typeof ImageGenerationSchema>;
