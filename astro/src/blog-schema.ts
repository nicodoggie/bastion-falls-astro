import { z } from "astro/zod";

export const blogSchema = <ImageSchema extends z.ZodType>(
  image: () => ImageSchema,
) => {
  const baseBlogSchema = z.object({
    title: z.string(),
    draft: z.boolean().optional(),
    author: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  });

  return z.discriminatedUnion("draft", [
    baseBlogSchema.extend({
      draft: z.literal(false).optional(),
      published: z.date(),
      updated: z.date().optional(),
      banner: z
        .object({
          url: image(),
          alt: z.string().optional(),
        })
        .optional(),
    }),
    baseBlogSchema.extend({
      draft: z.literal(true),
      banner: z
        .object({
          url: image(),
          alt: z.string().optional(),
        })
        .optional(),
    }),
  ]);
};
