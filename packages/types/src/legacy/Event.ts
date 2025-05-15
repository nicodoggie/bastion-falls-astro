import { z } from 'zod';

const EventFrontmatterSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  extraMetadata: z.object({
    event: z.object({
      date_started: z.string().optional(),
      date_ended: z.string().optional(),
      type: z.string().optional(),
      location: z.string().optional(),
    }).optional(),
  }).optional(),
});

export type EventFrontmatter = z.infer<typeof EventFrontmatterSchema>;
