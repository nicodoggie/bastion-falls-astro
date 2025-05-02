import { z } from "astro:content";

export const blogSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  date: z.string(),
  image: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type BlogPost = z.infer<typeof blogSchema>;