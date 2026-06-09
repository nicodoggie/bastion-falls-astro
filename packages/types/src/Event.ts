import { z } from "zod";
import { ImageSchema } from "./Image.js";

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
  image: ImageSchema.or(ImageSchema.array()).optional(),
  dateStarted: z.string().optional(),
  dateEnded: z.string().optional(),
  type: EventType.or(z.string()).optional(),
  locations: z.array(z.string()).optional(),
});

export type Event = z.infer<typeof EventSchema>;

