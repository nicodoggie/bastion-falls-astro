import { z } from 'zod';

export const EventSchema = z.object({
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

export type Event = z.infer<typeof EventSchema>;
