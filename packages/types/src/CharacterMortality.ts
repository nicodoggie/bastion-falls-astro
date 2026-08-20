import { BastionDate, CalendarDate } from "@bastion-falls/calendar";
import { z } from "zod";

export const MortalityStatusSchema = z.enum([
	"alive",
	"dead",
	"undead",
	"unknown",
]);
export type MortalityStatus = z.infer<typeof MortalityStatusSchema>;

export const MortalityPhaseTypeSchema = z.enum([
	"birth",
	"undeath",
	"revival",
	"rebirth",
]);
export type MortalityPhaseType = z.infer<typeof MortalityPhaseTypeSchema>;

const optionalDetail = z.string().trim().min(1).optional();
const phaseBase = {
	from: optionalDetail,
	to: optionalDetail,
	species: optionalDetail,
};

const BirthPhaseSchema = z
	.object({ type: z.literal("birth"), ...phaseBase })
	.strict();
const UndeathPhaseSchema = z
	.object({
		type: z.literal("undeath"),
		...phaseBase,
		species: z.string().trim().min(1),
	})
	.strict();
const RevivalPhaseSchema = z
	.object({ type: z.literal("revival"), ...phaseBase, method: optionalDetail })
	.strict();
const RebirthPhaseSchema = z
	.object({ type: z.literal("rebirth"), ...phaseBase, method: optionalDetail })
	.strict();

export const BirthPhase = BirthPhaseSchema;
export const UndeathPhase = UndeathPhaseSchema;
export const RevivalPhase = RevivalPhaseSchema;
export const RebirthPhase = RebirthPhaseSchema;

export const MortalityPhaseSchema = z.discriminatedUnion("type", [
	BirthPhaseSchema,
	UndeathPhaseSchema,
	RevivalPhaseSchema,
	RebirthPhaseSchema,
]);
export type CharacterMortalityPhase = z.infer<typeof MortalityPhaseSchema>;
export type BirthPhase = z.infer<typeof BirthPhaseSchema>;
export type UndeathPhase = z.infer<typeof UndeathPhaseSchema>;
export type RevivalPhase = z.infer<typeof RevivalPhaseSchema>;
export type RebirthPhase = z.infer<typeof RebirthPhaseSchema>;

function parsedDate(value: string): CalendarDate | undefined {
	try {
		return BastionDate.from(value);
	} catch {
		return undefined;
	}
}

function addDateError(
	ctx: z.RefinementCtx,
	path: (string | number)[],
	message: string,
): void {
	ctx.addIssue({ code: "custom", path, message });
}

const mortalityShape = z.object({
	status: MortalityStatusSchema,
	phases: z.array(MortalityPhaseSchema),
});

export const CharacterMortalitySchema = mortalityShape.superRefine(
	(mortality, ctx) => {
		if (
			mortality.status === "undead" &&
			!mortality.phases.some((phase) => phase.type === "undeath")
		) {
			addDateError(ctx, ["phases"], "undead status requires an undeath phase");
		}

		let previousFrom: CalendarDate | undefined;
		let previousTo: CalendarDate | undefined;
		const parsedPhases = mortality.phases.map((phase) => ({
			from: phase.from === undefined ? undefined : parsedDate(phase.from),
			to: phase.to === undefined ? undefined : parsedDate(phase.to),
			phase,
		}));
		const latest = parsedPhases.at(-1);
		const latestOpen =
			latest?.from !== undefined && latest.to === undefined ? latest : undefined;
		if (
			latestOpen &&
			mortality.status === "alive" &&
			!(["birth", "revival", "rebirth"] as const).includes(
				latestOpen.phase.type as "birth" | "revival" | "rebirth",
			)
		) {
			addDateError(ctx, ["phases"], "alive status requires a living latest open phase");
		}
		if (
			latestOpen &&
			mortality.status === "undead" &&
			latestOpen.phase.type !== "undeath"
		) {
			addDateError(ctx, ["phases"], "undead status requires an undeath latest open phase");
		}
		if (
			mortality.status === "dead" &&
			latestOpen &&
			parsedPhases.slice(0, -1).some((previous) => previous.to !== undefined)
		) {
			addDateError(ctx, ["phases"], "dead status cannot contain a later open existence phase");
		}
		for (const [index, phase] of mortality.phases.entries()) {
			const from =
				phase.from === undefined ? undefined : parsedDate(phase.from);
			const to = phase.to === undefined ? undefined : parsedDate(phase.to);

			if (phase.from !== undefined && from === undefined) {
				addDateError(
					ctx,
					["phases", index, "from"],
					"must be a valid Bastion date",
				);
			}
			if (phase.to !== undefined && to === undefined) {
				addDateError(
					ctx,
					["phases", index, "to"],
					"must be a valid Bastion date",
				);
			}
			if (
				from !== undefined &&
				to !== undefined &&
				from.precision === to.precision
			) {
				if (CalendarDate.compare(to, from) < 0) {
					addDateError(
						ctx,
						["phases", index],
						"phase to date cannot precede its from date",
					);
				}
			}

			if (
				from !== undefined &&
				previousFrom !== undefined &&
				from.precision === previousFrom.precision &&
				CalendarDate.compare(from, previousFrom) < 0
			) {
				addDateError(
					ctx,
					["phases", index, "from"],
					"phases must be ordered at matching precision",
				);
			}
			if (
				from !== undefined &&
				previousTo !== undefined &&
				from.precision === previousTo.precision &&
				CalendarDate.compare(from, previousTo) < 0
			) {
				addDateError(
					ctx,
					["phases", index, "from"],
					"phases must not overlap at matching precision",
				);
			}
			if (from !== undefined) previousFrom = from;
			if (to !== undefined) previousTo = to;
		}
	},
);
export type CharacterMortality = z.infer<typeof CharacterMortalitySchema>;
