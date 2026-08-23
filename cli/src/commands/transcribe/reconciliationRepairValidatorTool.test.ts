import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { RepairValidationInput } from "./reconciliationRepair.js";
import {
	allRepairFixtures,
	type RepairFixture,
} from "./reconciliationRepairFixtures.js";
import {
	createRepairValidationSession,
	RepairValidationResultSchema,
	runRepairValidatorToolStdio,
} from "./reconciliationRepairValidatorTool.js";

function validationFor(fixture: RepairFixture): RepairValidationInput {
	const expected = fixture.expectedRepairedOutput as
		| Record<string, unknown>
		| undefined;
	const identity =
		expected ??
		(JSON.parse(fixture.originalOutput || "{}") as Record<string, unknown>);
	return {
		packet: {
			schemaVersion: "reconciliation.v1",
			promptVersion: String(identity["promptVersion"] ?? "synthetic-prompt"),
			chunk: identity["chunk"] ?? {
				id: "chunk-synthetic-a",
				start: 0,
				end: 10,
			},
			cacheIdentity: identity["cacheIdentity"] ?? {
				inputHash: "hash-source-a",
				contextHash: "hash-context-a",
			},
		},
		authoritativeSourceEvents: [
			{
				id: "event-synthetic-a",
				text: "Speaker A said hello.",
				start: 1,
				end: 2,
			},
		],
	} as unknown as RepairValidationInput;
}

const positive = allRepairFixtures.find(
	(fixture) => fixture.id === "fixture-wrong-enum-location",
);
const negative = allRepairFixtures.find(
	(fixture) => fixture.id === "fixture-invented-source-id",
);
assert.ok(positive);
assert.ok(negative);

test("seals the exact first valid repaired submission", async () => {
	const session = createRepairValidationSession({
		originalOutput: positive.originalOutput,
		validation: validationFor(positive),
	});
	const envelope = {
		repairable: true as const,
		repairedOutput: positive.expectedRepairedOutput,
	};
	assert.deepEqual(await session.submit(envelope), {
		valid: true,
		submissionNumber: 1,
	});
	assert.deepEqual(session.sealedCandidate(), envelope);
	assert.equal(session.callCount(), 1);
});

test("returns bounded schema feedback without reading hostile accessors", async () => {
	let getterReads = 0;
	const hostile = Object.defineProperty(
		{ repairable: true },
		"repairedOutput",
		{
			enumerable: true,
			get() {
				getterReads += 1;
				return positive.expectedRepairedOutput;
			},
		},
	);
	const session = createRepairValidationSession({
		originalOutput: positive.originalOutput,
		validation: validationFor(positive),
	});
	const result = await session.submit(hostile);
	assert.equal(result.valid, false);
	assert.equal(getterReads, 0);
	assert.equal(JSON.stringify(result).includes("Speaker A said hello."), false);
	assert.equal(session.sealedCandidate(), undefined);
	assert.equal(RepairValidationResultSchema.safeParse(result).success, true);
});

test("permits one correction and seals only the corrected candidate", async () => {
	const session = createRepairValidationSession({
		originalOutput: positive.originalOutput,
		validation: validationFor(positive),
	});
	const invalid = await session.submit({
		repairable: true,
		repairedOutput: {},
	});
	assert.equal(invalid.valid, false);
	const corrected = {
		repairable: true as const,
		repairedOutput: positive.expectedRepairedOutput,
	};
	assert.deepEqual(await session.submit(corrected), {
		valid: true,
		submissionNumber: 2,
	});
	assert.deepEqual(session.sealedCandidate(), corrected);
	assert.deepEqual(await session.submit(corrected), {
		valid: false,
		submissionNumber: 2,
		issues: [{ code: "maximum-submissions-exceeded", path: [] }],
	});
	assert.equal(session.callCount(), 2);
});

test("retains the most recent valid submission after an invalid call", async () => {
	const session = createRepairValidationSession({
		originalOutput: positive.originalOutput,
		validation: validationFor(positive),
	});
	assert.equal(
		(
			await session.submit({
				repairable: true,
				repairedOutput: positive.expectedRepairedOutput,
			})
		).valid,
		true,
	);
	const invalid = await session.submit({ repairable: true, repairedOutput: {} });
	assert.equal(invalid.valid, false);
	assert.deepEqual(session.sealedCandidate(), {
		repairable: true,
		repairedOutput: positive.expectedRepairedOutput,
	});
});

test("returns bounded deterministic compiler categories and paths", async () => {
	const submit = async (
		repairedOutput: unknown,
		validation = validationFor(positive),
	) => {
		const session = createRepairValidationSession({
			originalOutput: positive.originalOutput,
			validation,
		});
		const result = await session.submit({ repairable: true, repairedOutput });
		assert.equal(result.valid, false);
		if (result.valid) throw new Error("expected invalid candidate");
		return result.issues[0];
	};
	assert.deepEqual(await submit({}), {
		code: "invalid-target-schema",
		path: ["repairedOutput", "schemaVersion"],
	});
	const changedIdentity = structuredClone(
		positive.expectedRepairedOutput,
	) as Record<string, unknown>;
	(changedIdentity["chunk"] as Record<string, unknown>)["id"] = "other";
	assert.deepEqual(await submit(changedIdentity), {
		code: "identity-mismatch",
		path: ["repairedOutput", "chunk"],
	});
	const changedText = structuredClone(
		positive.expectedRepairedOutput,
	) as Record<string, unknown>;
	const block = (changedText["blocks"] as Array<Record<string, unknown>>)[0];
	assert.ok(block);
	block["text"] = "Changed.";
	assert.deepEqual(await submit(changedText), {
		code: "protected-semantic-mismatch",
		path: ["repairedOutput"],
	});
	const badAuthority = structuredClone(validationFor(positive));
	badAuthority.authoritativeSourceEvents = [
		{ id: "event-other", text: "Speaker A said hello.", start: 1, end: 2 },
	];
	assert.deepEqual(
		await submit(positive.expectedRepairedOutput, badAuthority),
		{
			code: "authoritative-validation-failed",
			path: ["repairedOutput"],
		},
	);
});

test("accepts only the exact closed refusal expected by a negative fixture", async () => {
	const session = createRepairValidationSession({
		originalOutput: negative.originalOutput,
		validation: validationFor(negative),
		expectedUnrepairableReason: negative.expectedUnrepairableReason,
	});
	const wrong = await session.submit({
		repairable: false,
		reason: "unsupported-repair",
	});
	assert.equal(wrong.valid, false);
	assert.deepEqual(
		await session.submit({
			repairable: false,
			reason: negative.expectedUnrepairableReason,
		}),
		{
			valid: true,
			submissionNumber: 2,
		},
	);
});

test("runs as a bounded stdin/stdout validator script", async () => {
	const child = spawn(
		process.execPath,
		[
			"--import",
			"tsx",
			fileURLToPath(
				new URL("./reconciliationRepairValidatorTool.ts", import.meta.url),
			),
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	child.stdin.end(
		JSON.stringify({
			originalOutput: positive.originalOutput,
			validation: validationFor(positive),
			candidate: {
				repairable: true,
				repairedOutput: positive.expectedRepairedOutput,
			},
		}),
	);
	const code = await new Promise<number | null>((resolve) =>
		child.on("close", resolve),
	);
	assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
	assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString("utf8")), {
		valid: true,
		submissionNumber: 1,
	});
});

test("returns sanitized bounded feedback for malformed and oversized script input", async () => {
	for (const input of ["{not-json", "x".repeat(2_000_001)]) {
		const output = await runRepairValidatorToolStdio(input);
		assert.deepEqual(JSON.parse(output), {
			valid: false,
			submissionNumber: 1,
			issues: [{ code: "invalid-candidate-shape", path: [] }],
		});
		assert.equal(output.includes(input.slice(0, 32)), false);
	}
});

test("oversized script stdin fails without waiting for peer EOF", async () => {
	const child = spawn(
		process.execPath,
		[
			"--import",
			"tsx",
			fileURLToPath(
				new URL("./reconciliationRepairValidatorTool.ts", import.meta.url),
			),
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	child.stdin.on("error", () => undefined);
	child.stdin.write("x".repeat(2_000_001));
	const code = await Promise.race([
		new Promise<number | null>((resolve) => child.on("close", resolve)),
		new Promise<never>((_, reject) =>
			setTimeout(() => {
				child.kill("SIGKILL");
				reject(new Error("validator waited for EOF"));
			}, 2_000),
		),
	]);
	assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
	assert.equal(JSON.parse(Buffer.concat(stdout).toString("utf8")).valid, false);
});

test("rejects semantic, identity, accounting, shape, prototype, symbol, and size violations", async () => {
	const changedText = structuredClone(
		positive.expectedRepairedOutput,
	) as Record<string, unknown>;
	const changedBlock = (
		changedText["blocks"] as Array<Record<string, unknown>>
	)[0];
	assert.ok(changedBlock);
	changedBlock["text"] = "Changed.";
	const changedIdentity = structuredClone(
		positive.expectedRepairedOutput,
	) as Record<string, unknown>;
	(changedIdentity["chunk"] as Record<string, unknown>)["id"] = "other";
	const missingAccounting = structuredClone(
		positive.expectedRepairedOutput,
	) as Record<string, unknown>;
	const accountingBlock = (
		missingAccounting["blocks"] as Array<Record<string, unknown>>
	)[0];
	assert.ok(accountingBlock);
	accountingBlock["sourceEventIds"] = [];
	const prototypeKey = Object.defineProperty(
		{ repairable: true, repairedOutput: positive.expectedRepairedOutput },
		"__proto__",
		{ value: { polluted: true }, enumerable: true },
	);
	const noncanonicalArrayKey = structuredClone({
		repairable: true,
		repairedOutput: positive.expectedRepairedOutput,
	});
	const sourceEventIds = (
		(noncanonicalArrayKey.repairedOutput as Record<string, unknown>)[
			"blocks"
		] as Array<Record<string, unknown>>
	)[0]?.["sourceEventIds"] as unknown[];
	Object.defineProperty(sourceEventIds, "01", {
		value: "forged",
		enumerable: true,
	});
	const cases: unknown[] = [
		{ repairable: true, repairedOutput: changedText },
		{ repairable: true, repairedOutput: changedIdentity },
		{ repairable: true, repairedOutput: missingAccounting },
		{
			repairable: true,
			repairedOutput: positive.expectedRepairedOutput,
			extra: true,
		},
		Object.assign(Object.create({}), {
			repairable: true,
			repairedOutput: positive.expectedRepairedOutput,
		}),
		Object.assign(
			{ repairable: true, repairedOutput: positive.expectedRepairedOutput },
			{ [Symbol("x")]: true },
		),
		prototypeKey,
		noncanonicalArrayKey,
		{
			repairable: false,
			reason: "semantic-change-required",
			padding: "x".repeat(2_000_001),
		},
	];
	for (const candidate of cases) {
		const session = createRepairValidationSession({
			originalOutput: positive.originalOutput,
			validation: validationFor(positive),
		});
		const result = await session.submit(candidate);
		assert.equal(result.valid, false);
		assert.equal(RepairValidationResultSchema.safeParse(result).success, true);
		assert.equal(JSON.stringify(result).length < 4096, true);
	}
	assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});
