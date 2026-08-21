import {
	BastionDate,
	bastionCalendar,
	CalendarDate,
} from "@bastion-falls/calendar";
import type {
	CharacterMortality,
	CharacterMortalityPhase,
	MortalityPhaseType,
	MortalityStatus,
} from "./CharacterMortality.js";
import { CharacterMortalitySchema } from "./CharacterMortality.js";

export type MortalityDateInput = string | CalendarDate;

type ReplaceDates<T> = T extends unknown
	? Omit<T, "from" | "to"> & {
			from?: MortalityDateInput;
			to?: MortalityDateInput;
		}
	: never;

export type MortalityPhaseInput = ReplaceDates<CharacterMortalityPhase>;
export type CharacterMortalityInput = Omit<CharacterMortality, "phases"> & {
	phases: MortalityPhaseInput[];
};

export interface ResolvedMortalityPhase {
	readonly type: MortalityPhaseType;
	readonly from?: CalendarDate;
	readonly to?: CalendarDate;
	readonly species?: string;
	readonly method?: string;
	readonly durationDays?: number;
	readonly approximate: boolean;
	readonly open: boolean;
	readonly error?: string;
}

export interface ResolvedCharacterAge {
	readonly value?: number;
	readonly approximate: boolean;
	readonly source?: "authored" | "phases";
	readonly authoredAge?: number;
	readonly derivedAge?: number;
	readonly phases: readonly ResolvedMortalityPhase[];
	readonly error?: string;
}

interface ParsedDate {
	readonly date: CalendarDate;
	readonly originalPrecision: CalendarDate["precision"];
}

function parseDate(input: unknown): ParsedDate {
	if (input instanceof CalendarDate) {
		if (!input.isBoundTo(bastionCalendar)) {
			throw new Error("date CalendarDate is bound to a foreign calendar");
		}
		return { date: input, originalPrecision: input.precision };
	}
	if (typeof input !== "string")
		throw new Error("date must be a string or CalendarDate");
	const date = BastionDate.from(input);
	return { date, originalPrecision: date.precision };
}

function atPrecision(
	date: CalendarDate,
	precision: CalendarDate["precision"],
): CalendarDate {
	const fields = date.fields;
	if (precision === "year")
		return BastionDate.from({ era: fields.era, year: fields.year });
	const month = (fields as { month?: number }).month ?? 1;
	if (precision === "month")
		return BastionDate.from({ era: fields.era, year: fields.year, month });
	const day = (fields as { day?: number }).day ?? 1;
	return BastionDate.from({ era: fields.era, year: fields.year, month, day });
}

function coarsest(
	left: CalendarDate["precision"],
	right: CalendarDate["precision"],
): CalendarDate["precision"] {
	const rank = { year: 0, month: 1, day: 2 } as const;
	return rank[left] < rank[right] ? left : right;
}

function isLiving(type: MortalityPhaseType): boolean {
	return type === "birth" || type === "revival" || type === "rebirth";
}

function isMortalityPhaseType(value: unknown): value is MortalityPhaseType {
	return ["birth", "undeath", "revival", "rebirth"].includes(
		value as MortalityPhaseType,
	);
}

function statusAllowsOpen(
	status: MortalityStatus,
	type: MortalityPhaseType,
): boolean {
	return (
		(status === "alive" && isLiving(type)) ||
		(status === "undead" && type === "undeath")
	);
}

function phaseError(value: unknown): string {
	if (value instanceof Error && value.message) return value.message;
	return "invalid mortality phase";
}

function validateMortalityInput(value: unknown): string | undefined {
	try {
		if (
			!value ||
			typeof value !== "object" ||
			!Array.isArray((value as { phases?: unknown }).phases)
		) {
			return "mortality must contain a phases array";
		}
		const mortality = value as { phases: unknown[] };
		const phases = mortality.phases.map((raw) => {
			if (!raw || typeof raw !== "object") return raw;
			const phase = { ...(raw as Record<string, unknown>) };
			for (const key of ["from", "to"] as const) {
				const date = phase[key];
				if (date === undefined || typeof date === "string") continue;
				if (
					!(date instanceof CalendarDate) ||
					!date.isBoundTo(bastionCalendar)
				) {
					throw new Error(`${key} must be a string or bound CalendarDate`);
				}
				phase[key] = date.toString();
			}
			return phase;
		});
		const parsed = CharacterMortalitySchema.safeParse({
			...(value as Record<string, unknown>),
			phases,
		});
		if (parsed.success) return undefined;
		return parsed.error.issues
			.map(
				(issue) => `${issue.path.join(".") || "mortality"}: ${issue.message}`,
			)
			.join("; ");
	} catch (error) {
		return phaseError(error);
	}
}

export function resolveCharacterAge(
	input: {
		readonly age?: unknown;
		readonly mortality?: CharacterMortalityInput;
	},
	currentDate: MortalityDateInput,
): ResolvedCharacterAge {
	const phases: ResolvedMortalityPhase[] = [];
	const errors: string[] = [];
	let current: ParsedDate;
	try {
		current = parseDate(currentDate);
		if (current.date.precision !== "day")
			throw new Error("currentDate must have day precision");
	} catch (error) {
		current = undefined as never;
		errors.push(phaseError(error));
	}

	let authoredAge: number | undefined;
	if (
		input !== null &&
		typeof input === "object" &&
		Number.isSafeInteger(input.age) &&
		(input.age as number) >= 0
	) {
		authoredAge = input.age as number;
	} else if (
		input !== null &&
		typeof input === "object" &&
		input.age !== undefined
	) {
		errors.push("authored age must be a non-negative safe integer");
	}

	const mortality =
		input !== null && typeof input === "object" ? input.mortality : undefined;
	if (mortality === undefined) {
		return authoredAge !== undefined
			? {
					value: authoredAge,
					approximate: false,
					source: "authored",
					authoredAge,
					phases: [],
					...(errors.length ? { error: errors.join("; ") } : {}),
				}
			: {
					approximate: false,
					phases: [],
					...(errors.length ? { error: errors.join("; ") } : {}),
				};
	}

	if (
		!mortality ||
		typeof mortality !== "object" ||
		!Array.isArray(mortality.phases)
	) {
		errors.push("mortality must contain a phases array");
		return authoredAge !== undefined
			? {
					value: authoredAge,
					approximate: false,
					source: "authored",
					authoredAge,
					phases,
					error: errors.join("; "),
				}
			: { approximate: false, phases, error: errors.join("; ") };
	}

	let totalDays = 0;
	let measurable = true;
	const validationError = validateMortalityInput(mortality);
	if (validationError) {
		errors.push(validationError);
		measurable = false;
	}
	let previousEndDay: number | undefined;
	const rawPhases = mortality.phases as unknown[];
	for (let index = 0; index < rawPhases.length; index += 1) {
		const raw = rawPhases[index];
		const rawType =
			raw && typeof raw === "object"
				? (raw as { type?: unknown }).type
				: undefined;
		if (!isMortalityPhaseType(rawType)) {
			errors.push(`phase ${index}: phase type is invalid`);
			measurable = false;
			continue;
		}
		const phase = raw as {
			type: MortalityPhaseType;
			from?: unknown;
			to?: unknown;
			species?: unknown;
			method?: unknown;
		};
		let from: ParsedDate | undefined;
		let to: ParsedDate | undefined;
		let phaseFailure: string | undefined;
		if (phase.from !== undefined) {
			try {
				from = parseDate(phase.from);
			} catch (error) {
				phaseFailure = phaseError(error);
			}
		}
		if (phase.to !== undefined) {
			try {
				to = parseDate(phase.to);
			} catch (error) {
				phaseFailure ??= phaseError(error);
			}
		}
		let open = false;
		if (
			to === undefined &&
			phase.to === undefined &&
			index === rawPhases.length - 1 &&
			statusAllowsOpen(mortality.status, phase.type) &&
			current !== undefined &&
			from !== undefined
		) {
			to = current;
			open = true;
		}
		if (from === undefined || to === undefined || phaseFailure) {
			const error =
				phase.from === undefined
					? "phase is incomplete"
					: phaseFailure ?? "phase is incomplete";
			phases.push({
				type: phase.type,
				...(from ? { from: from.date } : {}),
				...(to ? { to: to.date } : {}),
				...(typeof phase.species === "string" ? { species: phase.species } : {}),
				...(typeof phase.method === "string" ? { method: phase.method } : {}),
				approximate: false,
				open,
				error,
			});
			measurable = false;
			errors.push(`phase ${index}: ${error}`);
			continue;
		}
		try {
			const precision = coarsest(from.originalPrecision, to.originalPrecision);
			const normalizedFrom = atPrecision(from.date, precision);
			const normalizedTo = atPrecision(to.date, precision);
			const durationDays =
				normalizedTo.precision === "day" && normalizedFrom.precision === "day"
					? normalizedTo.epochDay - normalizedFrom.epochDay
					: atPrecision(normalizedTo, "day").epochDay -
						atPrecision(normalizedFrom, "day").epochDay;
			if (durationDays < 0) throw new Error("phase to date cannot precede its from date");
			const normalizedFromDay = atPrecision(normalizedFrom, "day").epochDay;
			if (previousEndDay !== undefined && normalizedFromDay < previousEndDay)
				throw new Error("mortality phases overlap or are out of chronological order");
			const approximate = precision !== "day";
			phases.push({
				type: phase.type,
				from: from.date,
				to: to.date,
				...(typeof phase.species === "string" ? { species: phase.species } : {}),
				...(typeof phase.method === "string" ? { method: phase.method } : {}),
				durationDays,
				approximate,
				open,
			});
			totalDays += durationDays;
			previousEndDay = atPrecision(normalizedTo, "day").epochDay;
		} catch (error) {
			const message = phaseError(error);
			phases.push({
				type: phase.type,
				from: from.date,
				to: to.date,
				...(typeof phase.species === "string" ? { species: phase.species } : {}),
				...(typeof phase.method === "string" ? { method: phase.method } : {}),
				approximate: false,
				open,
				error: message,
			});
			measurable = false;
			errors.push(`phase ${index}: ${message}`);
		}
	}

	let derivedAge: number | undefined;
	if (rawPhases.length > 0 && measurable) {
		derivedAge = Math.floor(totalDays / bastionCalendar.daysPerYear);
	} else if (rawPhases.length > 0) {
		errors.push("mortality phases do not provide a complete derived age");
	}
	const approximate = phases.some((phase) => phase.approximate);
	const result: ResolvedCharacterAge = {
		...(authoredAge !== undefined
			? { value: authoredAge, source: "authored" as const, authoredAge }
			: derivedAge !== undefined
				? { value: derivedAge, source: "phases" as const }
				: {}),
		approximate,
		...(derivedAge !== undefined ? { derivedAge } : {}),
		phases,
		...(errors.length ? { error: errors.join("; ") } : {}),
	};
	return result;
}

export function getOriginalBirthDate(
	mortality: CharacterMortalityInput,
): string | undefined {
	const birth = mortality?.phases?.find((phase) => phase.type === "birth");
	if (!birth || birth.from === undefined) return undefined;
	try {
		return parseDate(birth.from).date.toString();
	} catch {
		return undefined;
	}
}

export function getCurrentDeathDate(
	mortality: CharacterMortalityInput,
): string | undefined {
	if (mortality?.status !== "dead" && mortality?.status !== "undead")
		return undefined;
	const phases = mortality.phases ?? [];
	const undeathIndex =
		mortality.status === "undead"
			? phases.map((phase) => phase.type).lastIndexOf("undeath")
			: phases.length;
	const candidates = phases
		.slice(0, undeathIndex)
		.filter((phase) => isLiving(phase.type) && phase.to !== undefined);
	const latest = candidates[candidates.length - 1];
	if (!latest?.to) return undefined;
	try {
		return parseDate(latest.to).date.toString();
	} catch {
		return undefined;
	}
}
