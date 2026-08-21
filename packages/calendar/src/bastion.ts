import type { DateInput } from "./date.js";
import { defineCalendar } from "./definition.js";

export const bastionCalendar = defineCalendar({
	id: "bastion",
	months: [
		{ id: "First", name: "First", days: 30 },
		{ id: "Second", name: "Second", days: 30 },
		{ id: "Third", name: "Third", days: 30 },
		{ id: "Fourth", name: "Fourth", days: 30 },
		{ id: "Fifth", name: "Fifth", days: 30 },
		{ id: "Sixth", name: "Sixth", days: 30 },
		{ id: "Seventh", name: "Seventh", days: 30 },
		{ id: "Eigth", name: "Eigth", days: 30 },
		{ id: "Nineth", name: "Nineth", days: 30 },
		{ id: "Tenth", name: "Tenth", days: 30 },
		{ id: "Eleventh", name: "Eleventh", days: 30 },
		{ id: "Twelfth", name: "Twelfth", days: 30 },
	],
	week: {
		weekdays: [
			"Sunday",
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday",
		],
		epochWeekday: 6,
	},
	eras: [
		{
			id: "AI",
			name: "AI",
			direction: 1,
			yearOffset: 0,
			minimumYear: 0,
		},
		{
			id: "PF",
			name: "PF",
			direction: -1,
			yearOffset: 0,
			minimumYear: 1,
		},
	],
	format: {
		eraPosition: "suffix",
		dateSeparator: "-",
		padMonth: 2,
		padDay: 2,
	},
	epoch: {
		epochDay: 0,
		year: 0,
		month: 1,
		day: 1,
	},
	overflow: "constrain",
});

export const BastionDate = Object.freeze({
	from(input: DateInput) {
		return bastionCalendar.dateFrom(input);
	},
	fromEpochDay(epochDay: number) {
		return bastionCalendar.dateFromEpochDay(epochDay);
	},
});
