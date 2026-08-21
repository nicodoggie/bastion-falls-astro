import { bastionCalendar } from "@bastion-falls/calendar";
import type {
	ResolvedCharacterAge,
	ResolvedMortalityPhase,
} from "@bastion-falls/types/CharacterAge";

export interface MortalityPhaseDescription {
	readonly event: string;
	readonly date?: string;
	readonly endDate?: string;
	readonly species?: string;
	readonly method?: string;
	readonly duration?: string;
}

export interface CharacterAgeDescription {
	readonly collapsedValue?: string;
	readonly approximate: boolean;
	readonly phases: readonly MortalityPhaseDescription[];
	readonly overrideExplanation?: string;
}

const EVENT_PHRASES = {
	birth: { event: "Born", closed: "Lived for", open: "Alive for" },
	undeath: {
		event: "Became undead",
		closed: "Was undead for",
		open: "Undead for",
	},
	revival: {
		event: "Revived",
		closed: "Lived again for",
		open: "Alive again for",
	},
	rebirth: {
		event: "Reborn",
		closed: "Lived this life for",
		open: "Living this life for",
	},
} as const;

function formatEventDate(phase: ResolvedMortalityPhase): string | undefined {
	return phase.from?.toString();
}

function formatDuration(days: number): string {
	const years = days / bastionCalendar.daysPerYear;
	if (Number.isInteger(years))
		return `${years} ${years === 1 ? "year" : "years"}`;
	return `${days} ${days === 1 ? "day" : "days"}`;
}

export function describeMortalityPhase(
	phase: ResolvedMortalityPhase,
): MortalityPhaseDescription {
	const phrases = EVENT_PHRASES[phase.type];
	const duration =
		phase.durationDays === undefined
			? undefined
			: `${phase.open ? phrases.open : phrases.closed} ${phase.approximate ? "~" : ""}${formatDuration(phase.durationDays)}`;
	return {
		event: phrases.event,
		...(formatEventDate(phase) ? { date: formatEventDate(phase) } : {}),
		...(!phase.from && phase.to ? { endDate: phase.to.toString() } : {}),
		...(phase.species ? { species: phase.species } : {}),
		...(phase.method ? { method: `Via ${phase.method}` } : {}),
		...(duration ? { duration } : {}),
	};
}

function overrideExplanation(age: ResolvedCharacterAge): string | undefined {
	if (age.authoredAge === undefined) return undefined;
	if (age.derivedAge === undefined && age.phases.length > 0)
		return "Authored age is provided; phase history is incomplete, so it cannot derive a total.";
	if (age.derivedAge === undefined) return undefined;
	if (age.authoredAge === age.derivedAge)
		return "Authored age matches the phase-derived age.";
	return `Authored age (${age.authoredAge}) overrides the phase-derived age (${age.derivedAge}).`;
}

export function describeCharacterAge(
	age: ResolvedCharacterAge,
): CharacterAgeDescription {
	const phases = age.phases
		.map(describeMortalityPhase)
		.filter(
			(phase) =>
				phase.date !== undefined ||
				phase.endDate !== undefined ||
				phase.species !== undefined ||
				phase.method !== undefined ||
				phase.duration !== undefined,
		);
	return {
		collapsedValue:
			age.value === undefined
				? undefined
				: `${age.approximate ? "~" : ""}${age.value}`,
		approximate: age.approximate,
		phases,
		...(overrideExplanation(age)
			? { overrideExplanation: overrideExplanation(age) }
			: {}),
	};
}
