import { z } from "zod";

export const FantasyCalendarDynamicDataSchema = z.object({
	current_date: z.object({
		year: z.number().int(),
		timespan: z.number().int(),
		day: z.number().int(),
	}),
	current_era: z.string(),
	epoch_day: z.number().int(),
});

export type FantasyCalendarDynamicData = z.infer<
	typeof FantasyCalendarDynamicDataSchema
>;
