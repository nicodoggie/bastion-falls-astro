import { z } from "zod";

export const FantasyCalendarEventIdSchema = z
	.union([
		z.string().trim().min(1),
		z.number().int().refine(Number.isSafeInteger, "must be a safe integer"),
	])
	.transform((value) => String(value).trim())
	.brand<"FantasyCalendarEventId">();

export type FantasyCalendarEventId = z.infer<
	typeof FantasyCalendarEventIdSchema
>;

export const FantasyCalendarEventReferenceSchema = z
	.object({ eventId: FantasyCalendarEventIdSchema })
	.strict();

export type FantasyCalendarEventReference = z.infer<
	typeof FantasyCalendarEventReferenceSchema
>;
