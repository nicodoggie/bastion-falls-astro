import { z } from "zod";

export const BaseFrontmatterSchema = z.object({
  title: z.string(),
  description: z.string().nullish(),
  slug: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
});

export type BaseFrontmatter = z.infer<typeof BaseFrontmatterSchema>;