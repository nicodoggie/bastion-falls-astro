import { z } from "zod";

const EventType = z.enum([
  "conference",
  "war",
  "battle",
  "revolution",
  "conquest",
  "festival",
  "speech",
  "meeting",
  "synod",
  "coup",
  "parade",
  "release",
  "anniversary",
  "shoot",
  "campaign",
  "session",
]);

export const EventSchema = z.object({
  name: z.string(),
  dateStarted: z.string().optional(),
  dateEnded: z.string().optional(),
  type: EventType.or(z.string()).optional(),
  locations: z.array(z.string()).optional(),
});

export type Event = z.infer<typeof EventSchema>;

