import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
	BastionDate,
	bastionCalendar,
	type CalendarDate,
	parseCalendarState,
} from "@bastion-falls/calendar";
import { glob } from "glob";
import type { LocalContext } from "../../context.js";
import { parse } from "../../lib/frontmatter.js";
import { resolveCalendarStatePaths } from "./state-files.js";

export const AUDIT_CATEGORIES = [
	"derived-only",
	"matching-override",
	"conflicting-override",
	"insufficient-precision",
	"invalid",
	"missing-date",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface CharacterAgeRecord {
	readonly file: string;
	readonly category: AuditCategory;
	readonly authoredAge?: number;
	readonly derivedAge?: number;
	readonly dateOfBirth?: string;
	readonly dateOfDeath?: string;
	readonly mortality?: string;
	readonly reason?: string;
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

function text(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
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
	const dateOfBirth: unknown = details["dateOfBirth"];
	const dateOfDeath: unknown = details["dateOfDeath"];
	const mortality: unknown = details["mortality"];
	const common = {
		...base,
		authoredAge: typeof authoredAge === "number" ? authoredAge : undefined,
		dateOfBirth: typeof dateOfBirth === "string" ? dateOfBirth : undefined,
		dateOfDeath: typeof dateOfDeath === "string" ? dateOfDeath : undefined,
		mortality: typeof mortality === "string" ? mortality : undefined,
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
	if (
		mortality !== undefined &&
		!["alive", "dead", "undead", "unknown"].includes(String(mortality))
	) {
		return record({
			...common,
			category: "invalid",
			reason: "mortality is invalid",
		});
	}
	if (dateOfBirth !== undefined && typeof dateOfBirth !== "string") {
		return record({
			...common,
			category: "invalid",
			reason: "dateOfBirth must be a string",
		});
	}
	if (dateOfDeath !== undefined && typeof dateOfDeath !== "string") {
		return record({
			...common,
			category: "invalid",
			reason: "dateOfDeath must be a string",
		});
	}
	const dead = mortality === "dead";
	if (!text(dateOfBirth) || (dead && !text(dateOfDeath))) {
		return record({
			...common,
			category: "missing-date",
			reason: dead
				? "dead character requires dateOfDeath"
				: "dateOfBirth is missing",
		});
	}

	let birthDate: CalendarDate;
	let deathDate: CalendarDate | undefined;
	try {
		birthDate = BastionDate.from(dateOfBirth);
		if (dead) deathDate = BastionDate.from(dateOfDeath as string);
	} catch {
		return record({
			...common,
			category: "invalid",
			reason: "date is malformed",
		});
	}
	if (
		birthDate.precision !== "day" ||
		(deathDate !== undefined && deathDate.precision !== "day")
	) {
		return record({
			...common,
			category: "insufficient-precision",
			reason: "age requires day-precision dates",
		});
	}
	try {
		const reference = deathDate ?? currentDate;
		const derivedAge = birthDate.ageOn(reference);
		if (authoredAge === undefined)
			return record({ ...common, category: "derived-only", derivedAge });
		return record({
			...common,
			category:
				authoredAge === derivedAge
					? "matching-override"
					: "conflicting-override",
			derivedAge,
		});
	} catch (error) {
		return record({
			...common,
			category: "invalid",
			reason:
				error instanceof Error ? error.message : "date relationship is invalid",
		});
	}
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
