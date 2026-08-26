import { Buffer } from "node:buffer";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	ReconciliationResponseSchema,
	validateReconciliation,
} from "./reconciliation.js";
import {
	buildProtectedProjection,
	classifyRepairFailure,
	evaluateFormatRepair,
	protectedDigest,
	type RepairEnvelope,
	RepairEnvelopeSchema,
	type RepairUnrepairableReason,
	RepairUnrepairableReasonSchema,
	type RepairValidationInput,
	RepairValidationRuntimeSchema,
	verifyLexicalPreservation,
} from "./reconciliationRepair.js";

const MAX_CANDIDATE_BYTES = 2_000_000;
const MAX_FEEDBACK_ISSUES = 16;
const MAX_PATH_DEPTH = 16;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 65_536;

const RepairValidationIssueCodeSchema = z.enum([
	"invalid-candidate-shape",
	"unexpected-repairability",
	"unexpected-refusal-reason",
	"invalid-target-schema",
	"identity-mismatch",
	"protected-semantic-mismatch",
	"authoritative-validation-failed",
	"candidate-validation-failed",
	"maximum-submissions-exceeded",
]);

const RepairValidationPathSchema = z
	.array(
		z.union([
			z.string().max(160),
			z.number().int().nonnegative().max(1_000_000),
		]),
	)
	.max(MAX_PATH_DEPTH);

export const RepairValidationResultSchema = z.discriminatedUnion("valid", [
	z
		.object({
			valid: z.literal(true),
			submissionNumber: z.union([z.literal(1), z.literal(2)]),
		})
		.strict(),
	z
		.object({
			valid: z.literal(false),
			submissionNumber: z.union([z.literal(1), z.literal(2)]),
			issues: z
				.array(
					z
						.object({
							code: RepairValidationIssueCodeSchema,
							path: RepairValidationPathSchema,
						})
						.strict(),
				)
				.min(1)
				.max(MAX_FEEDBACK_ISSUES),
		})
		.strict(),
]);

export type RepairValidationResult = z.infer<
	typeof RepairValidationResultSchema
>;

export interface RepairValidationSession {
	submit(candidate: unknown): Promise<RepairValidationResult>;
	sealedCandidate(): RepairEnvelope | undefined;
	callCount(): number;
}

export interface RepairValidationSessionOptions {
	originalOutput: string;
	validation: RepairValidationInput;
	expectedUnrepairableReason?: RepairUnrepairableReason;
	timeoutMs?: number;
	maxOutputBytes?: number;
}

function snapshotJson(value: unknown): unknown {
	let nodes = 0;
	const visit = (current: unknown, depth: number): unknown => {
		nodes += 1;
		if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH)
			throw new Error("invalid candidate");
		if (
			current === null ||
			typeof current === "string" ||
			typeof current === "boolean"
		)
			return current;
		if (typeof current === "number") {
			if (!Number.isFinite(current)) throw new Error("invalid candidate");
			return current;
		}
		if (
			typeof current !== "object" ||
			Object.getOwnPropertySymbols(current).length > 0
		)
			throw new Error("invalid candidate");
		const prototype = Object.getPrototypeOf(current);
		if (Array.isArray(current)) {
			if (prototype !== Array.prototype) throw new Error("invalid candidate");
			const descriptors = Object.getOwnPropertyDescriptors(current) as Record<
				string,
				PropertyDescriptor
			>;
			const lengthDescriptor = descriptors["length"];
			if (
				!lengthDescriptor ||
				typeof lengthDescriptor.value !== "number" ||
				lengthDescriptor.value !== current.length
			)
				throw new Error("invalid candidate");
			const output: unknown[] = [];
			for (let index = 0; index < current.length; index += 1) {
				const descriptor = descriptors[String(index)];
				if (!descriptor?.enumerable || !("value" in descriptor))
					throw new Error("invalid candidate");
				output.push(visit(descriptor.value, depth + 1));
			}
			if (
				Object.keys(descriptors).some((key) => {
					if (key === "length") return false;
					if (!/^(0|[1-9]\d*)$/u.test(key)) return true;
					const index = Number(key);
					return (
						!Number.isSafeInteger(index) ||
						index >= current.length ||
						String(index) !== key
					);
				})
			)
				throw new Error("invalid candidate");
			return output;
		}
		if (prototype !== Object.prototype) throw new Error("invalid candidate");
		const descriptors = Object.getOwnPropertyDescriptors(current);
		const output: Record<string, unknown> = {};
		for (const [key, descriptor] of Object.entries(descriptors)) {
			if (!descriptor.enumerable || !("value" in descriptor))
				throw new Error("invalid candidate");
			Object.defineProperty(output, key, {
				value: visit(descriptor.value, depth + 1),
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return output;
	};
	const snapshot = visit(value, 0);
	const serialized = JSON.stringify(snapshot);
	if (Buffer.byteLength(serialized, "utf8") > MAX_CANDIDATE_BYTES)
		throw new Error("invalid candidate");
	return snapshot;
}

function invalidResult(
	submissionNumber: 1 | 2,
	code: z.infer<typeof RepairValidationIssueCodeSchema>,
	path: readonly (string | number)[] = [],
): RepairValidationResult {
	return RepairValidationResultSchema.parse({
		valid: false,
		submissionNumber,
		issues: [{ code, path: path.slice(0, MAX_PATH_DEPTH) }],
	});
}

function schemaFailure(
	submissionNumber: 1 | 2,
	candidate: unknown,
): RepairValidationResult {
	const parsed = RepairEnvelopeSchema.safeParse(candidate);
	const paths = parsed.success
		? [[]]
		: parsed.error.issues
				.slice(0, MAX_FEEDBACK_ISSUES)
				.map((issue) => issue.path.slice(0, MAX_PATH_DEPTH));
	return RepairValidationResultSchema.parse({
		valid: false,
		submissionNumber,
		issues: paths.map((path) => ({ code: "invalid-candidate-shape", path })),
	});
}

function validationFailure(
	submissionNumber: 1 | 2,
	code: z.infer<typeof RepairValidationIssueCodeSchema>,
	paths: readonly (readonly (string | number)[])[],
): RepairValidationResult {
	return RepairValidationResultSchema.parse({
		valid: false,
		submissionNumber,
		issues: paths.slice(0, MAX_FEEDBACK_ISSUES).map((path) => ({
			code,
			path: path.slice(0, MAX_PATH_DEPTH),
		})),
	});
}

function candidatePreflight(
	options: RepairValidationSessionOptions,
	envelope: Extract<RepairEnvelope, { repairable: true }>,
	submissionNumber: 1 | 2,
): RepairValidationResult | undefined {
	const target = ReconciliationResponseSchema.safeParse(
		envelope.repairedOutput,
	);
	if (!target.success) {
		return validationFailure(
			submissionNumber,
			"invalid-target-schema",
			target.error.issues.map((issue) => [
				"repairedOutput",
				...issue.path.filter(
					(segment): segment is string | number =>
						typeof segment === "string" || typeof segment === "number",
				),
			]),
		);
	}
	const packet = options.validation.packet;
	for (const key of [
		"schemaVersion",
		"promptVersion",
		"chunk",
		"cacheIdentity",
	] as const) {
		if (JSON.stringify(target.data[key]) !== JSON.stringify(packet[key]))
			return invalidResult(submissionNumber, "identity-mismatch", [
				"repairedOutput",
				key,
			]);
	}
	let parsedOriginal: unknown;
	let classification: ReturnType<typeof classifyRepairFailure>;
	try {
		parsedOriginal = JSON.parse(options.originalOutput);
		const originalSchema =
			ReconciliationResponseSchema.safeParse(parsedOriginal);
		if (originalSchema.success)
			return invalidResult(submissionNumber, "candidate-validation-failed", [
				"repairedOutput",
			]);
		classification = classifyRepairFailure({
			originalOutput: options.originalOutput,
			parsedValue: parsedOriginal,
			zodIssues: originalSchema.error.issues,
		});
	} catch (error) {
		classification = classifyRepairFailure({
			originalOutput: options.originalOutput,
			parseError: error,
		});
	}
	const protection =
		classification.protection ??
		(() => {
			try {
				const value = buildProtectedProjection(parsedOriginal);
				return {
					kind: "projection" as const,
					value,
					digest: protectedDigest(value),
				};
			} catch {
				return undefined;
			}
		})();
	if (!protection)
		return invalidResult(submissionNumber, "candidate-validation-failed", [
			"repairedOutput",
		]);
	try {
		if (protection.kind === "projection") {
			if (
				protectedDigest(buildProtectedProjection(target.data)) !==
				protection.digest
			)
				return invalidResult(submissionNumber, "protected-semantic-mismatch", [
					"repairedOutput",
				]);
		} else verifyLexicalPreservation(protection.value, target.data);
	} catch {
		return invalidResult(submissionNumber, "protected-semantic-mismatch", [
			"repairedOutput",
		]);
	}
	try {
		validateReconciliation(target.data, {
			authoritativeSourceEvents: options.validation.authoritativeSourceEvents,
		});
	} catch {
		return invalidResult(submissionNumber, "authoritative-validation-failed", [
			"repairedOutput",
		]);
	}
	return undefined;
}

export function createRepairValidationSession(
	options: RepairValidationSessionOptions,
): RepairValidationSession {
	const frozenValidation = Object.freeze(
		snapshotJson(RepairValidationRuntimeSchema.parse(options.validation)),
	) as RepairValidationInput;
	const sessionOptions = { ...options, validation: frozenValidation };
	let calls = 0;
	let sealed: RepairEnvelope | undefined;
	return {
		async submit(candidate: unknown): Promise<RepairValidationResult> {
			if (calls >= 2)
				return invalidResult(2, "maximum-submissions-exceeded");
			calls += 1;
			const submissionNumber = calls as 1 | 2;
			let snapshot: unknown;
			try {
				snapshot = snapshotJson(candidate);
			} catch {
				return invalidResult(submissionNumber, "invalid-candidate-shape");
			}
			const parsed = RepairEnvelopeSchema.safeParse(snapshot);
			if (!parsed.success) return schemaFailure(submissionNumber, snapshot);
			const envelope = parsed.data;
			if (!envelope.repairable) {
				if (sessionOptions.expectedUnrepairableReason === undefined)
					return invalidResult(submissionNumber, "unexpected-repairability", [
						"repairable",
					]);
				if (envelope.reason !== sessionOptions.expectedUnrepairableReason)
					return invalidResult(submissionNumber, "unexpected-refusal-reason", [
						"reason",
					]);
				sealed = envelope;
				return RepairValidationResultSchema.parse({
					valid: true,
					submissionNumber,
				});
			}
			const preflight = candidatePreflight(sessionOptions, envelope, submissionNumber);
			if (preflight) return preflight;
			if (sessionOptions.expectedUnrepairableReason !== undefined)
				return invalidResult(submissionNumber, "unexpected-repairability", [
					"repairable",
				]);
			const evaluation = await evaluateFormatRepair({
				originalOutput: sessionOptions.originalOutput,
				validation: sessionOptions.validation,
				invoke: async () => JSON.stringify(envelope),
				timeoutMs: options.timeoutMs,
				maxOutputBytes: options.maxOutputBytes,
			});
			if (evaluation.outcome !== "accepted")
				return invalidResult(submissionNumber, "candidate-validation-failed");
			sealed = envelope;
			return RepairValidationResultSchema.parse({
				valid: true,
				submissionNumber,
			});
		},
		sealedCandidate: () =>
			sealed === undefined ? undefined : structuredClone(sealed),
		callCount: () => calls,
	};
}

const StdioRequestSchema = z
	.object({
		originalOutput: z.string().max(MAX_CANDIDATE_BYTES),
		validation: z.unknown(),
		candidate: z.unknown(),
		expectedUnrepairableReason: RepairUnrepairableReasonSchema.optional(),
	})
	.strict();

export async function runRepairValidatorToolStdio(
	input: string,
): Promise<string> {
	try {
		if (Buffer.byteLength(input, "utf8") > MAX_CANDIDATE_BYTES)
			return `${JSON.stringify(invalidResult(1, "invalid-candidate-shape"))}\n`;
		const request = StdioRequestSchema.parse(JSON.parse(input));
		const session = createRepairValidationSession({
			originalOutput: request.originalOutput,
			validation: request.validation as RepairValidationInput,
			expectedUnrepairableReason: request.expectedUnrepairableReason,
		});
		return `${JSON.stringify(await session.submit(request.candidate))}\n`;
	} catch {
		return `${JSON.stringify(invalidResult(1, "invalid-candidate-shape"))}\n`;
	}
}

if (
	process.argv[1] &&
	(await realpath(process.argv[1])) ===
		(await realpath(fileURLToPath(import.meta.url)))
) {
	const input = await new Promise<string | undefined>((resolveInput) => {
		const chunks: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		const finish = (value: string | undefined, destroy = false) => {
			if (settled) return;
			settled = true;
			process.stdin.off("data", onData);
			process.stdin.off("end", onEnd);
			process.stdin.off("error", onError);
			if (destroy) process.stdin.destroy();
			resolveInput(value);
		};
		const onData = (chunk: Buffer | string) => {
			const buffer = Buffer.from(chunk);
			bytes += buffer.byteLength;
			if (bytes > MAX_CANDIDATE_BYTES) finish(undefined, true);
			else chunks.push(buffer);
		};
		const onEnd = () => finish(Buffer.concat(chunks).toString("utf8"));
		const onError = () => finish(undefined, true);
		process.stdin.on("data", onData);
		process.stdin.once("end", onEnd);
		process.stdin.once("error", onError);
		process.stdin.resume();
	});
	process.stdout.write(
		input === undefined
			? `${JSON.stringify(invalidResult(1, "invalid-candidate-shape"))}\n`
			: await runRepairValidatorToolStdio(input),
	);
}
