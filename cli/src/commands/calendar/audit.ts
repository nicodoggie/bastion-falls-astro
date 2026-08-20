import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
	bastionCalendar,
	type CalendarDate,
	parseCalendarState,
} from "@bastion-falls/calendar";
import type { CharacterMortalityInput } from "@bastion-falls/types/CharacterAge";
import { resolveCharacterAge } from "@bastion-falls/types/CharacterAge";
import { CharacterMortalitySchema } from "@bastion-falls/types/CharacterMortality";
import { glob } from "glob";
import type { LocalContext } from "../../context.js";
import { parse } from "../../lib/frontmatter.js";
import { resolveCalendarStatePaths } from "./state-files.js";

export const AUDIT_CATEGORIES = [
	"derived-only",
	"matching-override",
	"conflicting-override",
	"invalid",
	"missing-date",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface CharacterAgeRecord {
	readonly file: string;
	readonly category: AuditCategory;
	readonly authoredAge?: number;
	readonly derivedAge?: number;
	readonly status?: string;
	readonly phases?: readonly NormalizedPhaseEvidence[];
	readonly approximate?: boolean;
	readonly reason?: string;
}

export interface NormalizedPhaseEvidence {
	readonly type: string;
	readonly from?: string;
	readonly to?: string;
	readonly species?: string;
	readonly method?: string;
	readonly durationDays?: number;
	readonly approximate: boolean;
	readonly open: boolean;
	readonly error?: string;
}

export interface CompactCharacterRecord {
	readonly file: string;
	readonly details: unknown;
}

function record(
	base: Omit<CharacterAgeRecord, "category"> & { category: AuditCategory },
): CharacterAgeRecord {
	return Object.fromEntries(
		Object.entries(base).filter(([, value]) => value !== undefined),
	) as unknown as CharacterAgeRecord;
}

export function classifyCharacterAge(
	input: CompactCharacterRecord,
	currentDate: CalendarDate,
): CharacterAgeRecord {
	const base = { file: input.file };
	if (
		input.details === null ||
		typeof input.details !== "object" ||
		Array.isArray(input.details)
	) {
		return record({
			...base,
			category: "invalid",
			reason: "details must be an object",
		});
	}
	const details = input.details as Record<string, unknown>;
	if ("__parseError" in details) {
		return record({
			...base,
			category: "invalid",
			reason: "frontmatter could not be parsed",
		});
	}
	const authoredAge: unknown = details["age"];
	const mortality: unknown = details["mortality"];
	const common: Omit<CharacterAgeRecord, "category"> = {
		...base,
		authoredAge: typeof authoredAge === "number" ? authoredAge : undefined,
		status:
			mortality && typeof mortality === "object" && !Array.isArray(mortality)
				? typeof (mortality as Record<string, unknown>)["status"] === "string"
					? ((mortality as Record<string, unknown>)["status"] as string)
					: undefined
				: undefined,
		phases: undefined,
	};

	if (
		authoredAge !== undefined &&
		(typeof authoredAge !== "number" ||
			!Number.isSafeInteger(authoredAge) ||
			authoredAge < 0)
	) {
		return record({
			...common,
			category: "invalid",
			reason: "age must be a non-negative safe integer",
		});
	}
	if (!mortality || typeof mortality !== "object" || Array.isArray(mortality)) {
		return record({
			...common,
			category: "missing-date",
			reason: "mortality history is missing",
		});
	}
	const mortalityValidation = CharacterMortalitySchema.safeParse(mortality);
	const resolved = resolveCharacterAge(
		{ age: authoredAge, mortality: mortality as CharacterMortalityInput },
		currentDate,
	);
	const rawPhaseInputs =
		mortality && typeof mortality === "object" && !Array.isArray(mortality)
			? Array.isArray((mortality as Record<string, unknown>)["phases"])
				? ((mortality as Record<string, unknown>)["phases"] as unknown[])
				: []
			: [];
	const phases = resolved.phases.map((phase, index) => {
		const raw = rawPhaseInputs[index];
		const rawRecord = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		return {
			type: phase.type,
			...(phase.from
				? { from: phase.from.toString() }
				: typeof rawRecord["from"] === "string" ? { from: rawRecord["from"] } : {}),
			...(phase.to
				? { to: phase.to.toString() }
				: typeof rawRecord["to"] === "string" ? { to: rawRecord["to"] } : {}),
		...(phase.species ? { species: phase.species } : {}),
		...(phase.method ? { method: phase.method } : {}),
		...(phase.durationDays !== undefined
			? { durationDays: phase.durationDays }
			: {}),
		approximate: phase.approximate,
		open: phase.open,
		...(phase.error ? { error: phase.error } : {}),
		};
	});
	const withEvidence = {
		...common,
		phases,
		approximate: resolved.approximate,
		derivedAge: resolved.derivedAge,
	};
	const hasInvalidEvidence = resolved.phases.some(
		(phase) =>
			phase.error !== undefined &&
			!phase.error.includes("phase is incomplete") &&
			!phase.error.includes("date must be a string or CalendarDate"),
	);
	const hasSchemaError = !mortalityValidation.success;
	if (hasInvalidEvidence || hasSchemaError)
		return record({
			...withEvidence,
			category: "invalid",
			reason: resolved.error,
		});
	if (resolved.derivedAge === undefined)
		return record({
			...withEvidence,
			category: "missing-date",
			reason: resolved.error ?? "phase history is incomplete",
		});
	if (authoredAge === undefined)
		return record({ ...withEvidence, category: "derived-only" });
	return record({
		...withEvidence,
		category:
			authoredAge === resolved.derivedAge
				? "matching-override"
				: "conflicting-override",
	});
}

export interface AuditOptions {
	readonly currentPath?: string;
	readonly paths?: Awaited<ReturnType<typeof resolveCalendarStatePaths>>;
	readonly records?: readonly CompactCharacterRecord[];
	readonly readFile?: (path: string) => Promise<string>;
}

export async function auditCharacterAges(
	options: AuditOptions = {},
): Promise<readonly CharacterAgeRecord[]> {
	const paths =
		options.paths ?? (await resolveCalendarStatePaths(options.currentPath));
	const readStateFile =
		options.readFile ?? ((path: string) => readFile(path, "utf8"));
	const state = parseCalendarState(
		bastionCalendar,
		JSON.parse(await readStateFile(paths.resolvedPath)),
	);
	const currentDate = bastionCalendar.dateFrom(state.date);
	const records =
		options.records ?? (await discoverCharacters(paths.repositoryRoot));
	return records
		.map((item) => classifyCharacterAge(item, currentDate))
		.sort((a, b) => a.file.localeCompare(b.file));
}

async function discoverCharacters(
	root: string,
): Promise<CompactCharacterRecord[]> {
	const files = (
		await glob("astro/src/content/docs/world/characters/**/*.mdx", {
			cwd: root,
			absolute: true,
		})
	).sort();
	const result: CompactCharacterRecord[] = [];
	for (const path of files) {
		try {
			const frontmatter = await parse(path);
			const characterRoot =
				frontmatter !== null &&
				typeof frontmatter === "object" &&
				!Array.isArray(frontmatter)
					? (frontmatter as Record<string, unknown>)["character"]
					: undefined;
			const details =
				characterRoot !== null &&
				typeof characterRoot === "object" &&
				!Array.isArray(characterRoot)
					? (characterRoot as Record<string, unknown>)["details"]
					: undefined;
			result.push({
				file: relative(root, path).split("\\").join("/"),
				details,
			});
		} catch (error) {
			result.push({
				file: relative(root, path).split("\\").join("/"),
				details: { __parseError: error },
			});
		}
	}
	return result;
}

function counts(
	records: readonly CharacterAgeRecord[],
): Record<AuditCategory, number> {
	return Object.fromEntries(
		AUDIT_CATEGORIES.map((category) => [
			category,
			records.filter((item) => item.category === category).length,
		]),
	) as Record<AuditCategory, number>;
}

interface AuditFlags {
	readonly json?: boolean;
}

export default async function auditCommand(
	this: LocalContext,
	flags: AuditFlags,
): Promise<void> {
	const records = await auditCharacterAges({ currentPath: this.currentPath });
	if (flags.json) {
		this.process.stdout.write(`${JSON.stringify(records)}\n`);
		return;
	}
	this.process.stdout.write(
		`${AUDIT_CATEGORIES.map((category) => `${category}: ${counts(records)[category]}`).join("\n")}\n`,
	);
	for (const item of records.filter(
		(record) => record.category === "conflicting-override",
	)) {
		this.process.stdout.write(
			`${item.file}: authored ${item.authoredAge}, derived ${item.derivedAge}\n`,
		);
	}
}
