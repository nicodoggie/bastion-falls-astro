import { z } from "zod";

export const FantasyCalendarDynamicDataSchema = z.object({
	dynamic_data: z.object({
		year: z.number().int(),
		timespan: z.number().int(),
		day: z.number().int(),
		epoch: z.number().int(),
		current_era: z.number().int(),
	}),
});

export type FantasyCalendarDynamicData = z.infer<
	typeof FantasyCalendarDynamicDataSchema
>;
