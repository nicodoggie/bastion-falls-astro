import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, access, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  buildHermesReconciliationArgs,
  buildUnifiedReconciliationPrompt,
  parseHermesReconciliationJson,
  parseStrictReconciliationJson,
  boundedHermes,
  runUnifiedReconciliation,
  writeCanonicalReconciliationAtomic,
  writeReconciliationTextAtomic,
  PendingSummarySafetyError,
  validateReconciliationOutput,
  type ReconciliationChunkJob,
} from "./reconciliationRunner.js";

const source = [{ id: "e1", text: "hello", start: 0, end: 1, confidence: .9 }];
const owned = [{ ...source[0]!, sourcePass: "left", alternatives: [] }];
const packet = {
  evidenceVersion: 1 as const, promptVersion: "reconciliation.prompt.v1", schemaVersion: "reconciliation.v1",
  chunk: { id: "session_000", start: 0, end: 2 }, ownedEvents: owned, context: { contextOnly: true as const, previousReadableTail: ["context"], nextAlignmentHead: [] },
  expectedCharacters: [], glossary: [], correctionRules: [], provider: { provider: "hermes", model: "test" }, evidenceRevision: "r1",
  cacheIdentity: { inputHash: "i", contextHash: "c", sourceHash: "s", alignmentHash: "a", neighborHash: "n", channelMapHash: "m", glossaryHash: "g", correctionRulesHash: "r", evidenceRevision: "r1", providerIdentity: "p" },
};
const job: ReconciliationChunkJob = { packet, authoritativeSourceEvents: source };
const response = () => ({ schemaVersion: "reconciliation.v1", promptVersion: packet.promptVersion, chunk: packet.chunk, cacheIdentity: packet.cacheIdentity,
  blocks: [{ id: "b1", start: 0, end: 1, kind: "dialogue", text: "Hello.", summarySafeText: "Hello.", characterConfidence: "unknown", attributionBasis: ["none"], sourceEventIds: ["e1"], reviewFlags: [] }], omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [], summarySafety: { status: "valid", errors: [] } });

test("prompt marks neighbors context-only and owns only the packet window", () => {
  const prompt = buildUnifiedReconciliationPrompt(job);
  assert.match(prompt, /context-only/iu);
  assert.match(prompt, /session_000/iu);
  assert.match(prompt, /read-only/iu);
  assert.match(prompt, /complete output contract/iu);
  assert.match(prompt, /materialCorrections/iu);
  assert.match(prompt, /characterConfidence.*confirmed.*probable.*unknown/isu);
  assert.match(prompt, /expectedCharacters.*candidate.*not.*proof/iu);
  assert.match(prompt, /channel.*physicalSpeaker.*supplied.*evidence/isu);
  assert.match(prompt, /do not search the repository for schemas/iu);
  assert.match(prompt, /suspicionFlags.*must never.*reviewFlags/iu);
  assert.match(prompt, /derive.*start.*minimum.*end.*maximum.*sourceEventIds/isu);
  assert.match(prompt, /runner.*recomputes.*start.*end.*authoritative/isu);
  assert.match(prompt, /attributionBasis.*materialCorrection.*evidence.*reviewNotes.*summarySafety.*errors.*256/isu);
  assert.doesNotMatch(prompt, /emit neighboring events/iu);
});

test("Hermes args use the repository chat contract", () => {
  const args = buildHermesReconciliationArgs({ promptPath: "/tmp/reconciliation-request.json", profile: "p", maxTurns: 7 });
  assert.deepEqual(args.slice(0, 13), ["hermes", "--profile", "p", "chat", "-Q", "--source", "tool", "-t", "file", "-s", "bastion-transcript-evidence-workflows,bastion-note-review-corrections", "--max-turns", "7"]);
  assert.equal(args.at(-2), "-q");
  assert.match(args.at(-1)!, /\/tmp\/reconciliation-request\.json/u);
});

test("strict JSON parser rejects trailing non-whitespace", () => {
  assert.deepEqual(parseStrictReconciliationJson(JSON.stringify(response())), response());
  assert.throws(() => parseStrictReconciliationJson(`${JSON.stringify(response())}\nnot-json`));
  const maxTurns = `\u26a0\ufe0f  Reached maximum iterations (8). Requesting summary...\r\n${JSON.stringify(response())}`;
  assert.throws(() => parseStrictReconciliationJson(maxTurns));
  assert.deepEqual(parseHermesReconciliationJson(maxTurns), response());
  assert.throws(() => parseHermesReconciliationJson(`notice\n${JSON.stringify(response())}`));
});

test("one ordinary call writes canonical JSON, joined derivatives, and diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-runner-"));
  let calls = 0; let checkpointSawPublished = false;
  try {
    const result = await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: async () => { calls += 1; return { stdout: JSON.stringify(response()), stderr: "warn", metadata: { exitCode: 0 } }; }, checkpoint: async () => { await readFile(join(root, "reconciliation/session_000.json"), "utf8"); checkpointSawPublished = true; } });
    assert.equal(calls, 1); assert.equal(checkpointSawPublished, true);
    assert.equal(result.chunks.length, 1);
    assert.match(await readFile(join(root, "reconciled_transcript.md"), "utf8"), /Hello/);
    assert.match(await readFile(join(root, "summary_transcript.md"), "utf8"), /Hello/);
    assert.ok((await readdir(join(root, "diagnostics"))).length > 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("hard-invalid output is diagnostic-only and never creates canonical JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-invalid-"));
  try {
    await assert.rejects(() => runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: async () => ({ stdout: `${JSON.stringify(response())} trailing`, stderr: "raw", metadata: { token: "m" } }) }));
    await assert.rejects(() => access(join(root, "reconciliation", "session_000.json")));
    const diagnostic = await readFile(join(root, "diagnostics", (await readdir(join(root, "diagnostics")))[0]!), "utf8");
    assert.match(diagnostic, /trailing|strict JSON/iu); assert.match(diagnostic, /raw/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cache-identical resume makes zero calls, while stale identity repairs", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-resume-")); let calls = 0;
  try {
    const invoke = async () => { calls += 1; return JSON.stringify(response()); };
    await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, resume: true });
    await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, resume: true });
    assert.equal(calls, 1);
    const stale = { ...response(), cacheIdentity: { ...packet.cacheIdentity, neighborHash: "changed" } };
    await writeFile(join(root, "reconciliation/session_000.json"), JSON.stringify(stale));
    await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, resume: true });
    assert.equal(calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("persisted invalid status is stale and receives exactly one repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-resume-invalid-status-")); let calls = 0;
  try {
    const invoke = async () => { calls += 1; return JSON.stringify(response()); };
    await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, resume: true });
    await writeFile(join(root, "reconciliation/session_000.json"), JSON.stringify({ ...response(), status: "invalid" }));
    const result = await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, resume: true });
    assert.equal(calls, 2);
    assert.deepEqual(result.repairedChunkIds, ["session_000"]);
    assert.deepEqual(result.reusedChunkIds, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("persisted status inconsistent with authoritative validation is stale and repaired", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-resume-status-mismatch-")); let calls = 0;
  try {
    const invoke = async () => { calls += 1; return JSON.stringify(response()); };
    await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, resume: true });
    await writeFile(join(root, "reconciliation/session_000.json"), JSON.stringify({ ...response(), status: "needs_review" }));
    const result = await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, resume: true });
    assert.equal(calls, 2);
    assert.deepEqual(result.repairedChunkIds, ["session_000"]);
    assert.equal(result.chunks[0]!.status, "valid");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pending summary-safe text is persisted before fallback and exact block mapping replaces it", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-fallback-")); let fallbackCalls = 0;
  try {
    const pending = response() as any; pending.blocks[0]!.summarySafeText = ""; pending.summarySafety = { status: "pending", errors: ["unsafe"] };
    const result = await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: async () => JSON.stringify(pending), sanitizeSummarySafe: async ({ blocks }: { blocks: readonly { id: string }[] }) => { fallbackCalls += 1; return { [blocks[0]!.id]: "Safe hello." }; } });
    assert.equal(fallbackCalls, 1); assert.equal(result.chunks[0]!.summarySafety.status, "valid"); assert.match(await readFile(join(root, "summary_transcript.md"), "utf8"), /Safe hello/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("semantic echo accepts reordered keys and hard-invalid unknown events", () => {
  const reordered = JSON.parse(JSON.stringify(response())); reordered.chunk = { end: 2, id: "session_000", start: 0 }; reordered.cacheIdentity = Object.fromEntries(Object.entries(packet.cacheIdentity).reverse());
  assert.equal(validateReconciliationOutput(reordered, job).status, "valid");
  assert.throws(() => validateReconciliationOutput({ ...reordered, status: "valid" }, job));
  reordered.blocks[0].sourceEventIds = ["unknown"]; assert.throws(() => validateReconciliationOutput(reordered, job), /unknown event/iu);
});

test("runner derives redundant source echoes from authoritative event IDs", () => {
  const model = response();
  model.blocks[0]!.start = 0.25;
  model.blocks[0]!.end = 0.75;
  (model as any).materialCorrections = [{ sourceEventId: "e1", sourceForm: "wrong", replacement: "Hello.", evidence: ["source event"] }];
  const canonical = validateReconciliationOutput(model, job);
  assert.deepEqual([canonical.blocks[0]!.start, canonical.blocks[0]!.end], [0, 1]);
  assert.equal(canonical.materialCorrections[0]!.sourceForm, "hello");
});

test("semantic hard-invalid output is diagnostic-only through the runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-semantic-invalid-"));
  try {
    const invalid = response();
    invalid.blocks[0]!.sourceEventIds = ["unknown"];
    await assert.rejects(
      () => runUnifiedReconciliation({
        rootDir: root,
        jobs: [job],
        invokeReconciliation: async () => JSON.stringify(invalid),
      }),
      /unknown event/iu,
    );
    await assert.rejects(() => access(join(root, "reconciliation/session_000.json")));
    const diagnosticName = (await readdir(join(root, "diagnostics")))[0]!;
    assert.match(
      await readFile(join(root, "diagnostics", diagnosticName), "utf8"),
      /unknown event/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fresh existing artifacts require resume or force, and force regenerates", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-policy-")); let calls = 0;
  try { const invoke = async () => { calls += 1; return JSON.stringify(response()); }; await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke }); const names = ["reconciled_transcript.md", "summary_transcript.md", "reconciliation_review_queue.md"]; const joinedBefore = await Promise.all(names.map((name) => readFile(join(root, name), "utf8"))); await assert.rejects(() => runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke }), /resume or force/iu); assert.deepEqual(await Promise.all(names.map((name) => readFile(join(root, name), "utf8"))), joinedBefore); await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, resume: true }); await runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: invoke, force: true }); assert.equal(calls, 2); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects unsafe chunk IDs before creating paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-path-"));
  try { const unsafe = { ...job, packet: { ...packet, chunk: { ...packet.chunk, id: "../escape" } } } as ReconciliationChunkJob; await assert.rejects(() => runUnifiedReconciliation({ rootDir: root, jobs: [unsafe] }), /unsafe reconciliation chunk id/iu); assert.deepEqual(await readdir(root), []); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("fallback failure retains pending canonical and skips checkpoint and summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-fallback-fail-")); let checkpoints = 0;
  try { const pending = response() as any; pending.blocks[0].summarySafeText = ""; pending.summarySafety = { status: "pending", errors: ["unsafe"] }; await assert.rejects(() => runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation: async () => JSON.stringify(pending), sanitizeSummarySafe: async () => { throw new Error("fallback down"); }, checkpoint: () => { checkpoints += 1; } }), PendingSummarySafetyError); assert.equal(checkpoints, 0); assert.match(await readFile(join(root, "reconciliation/session_000.json"), "utf8"), /pending/); await assert.rejects(() => access(join(root, "summary_transcript.md"))); const resumed = await runUnifiedReconciliation({ rootDir: root, jobs: [job], resume: true, invokeReconciliation: async () => { throw new Error("ordinary must not retry"); }, sanitizeSummarySafe: async () => ({ b1: "Recovered safely." }) }); assert.equal(resumed.chunks[0]!.summarySafety.status, "valid"); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("injected operations abort on timeout and reject oversized output", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-bounds-")); let aborted = false;
  try { await assert.rejects(() => runUnifiedReconciliation({ rootDir: root, jobs: [job], timeoutMs: 10, invokeReconciliation: async (_job: ReconciliationChunkJob, _prompt: string, signal: AbortSignal) => await new Promise<string>((resolve) => { signal.addEventListener("abort", () => { aborted = true; resolve(JSON.stringify(response())); }); }) }), /timed out/iu); assert.equal(aborted, true); await assert.rejects(() => runUnifiedReconciliation({ rootDir: root, jobs: [job], maxOutputBytes: 8, invokeReconciliation: async () => "x".repeat(100) }), /output exceeded bound/iu); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects excessive runner and prompt bounds before invocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-hard-bounds-"));
  let calls = 0;
  const invokeReconciliation = async () => { calls += 1; return JSON.stringify(response()); };
  try {
    for (const options of [
      { timeoutMs: 600_001 },
      { maxOutputBytes: 20_000_001 },
      { maxTurns: 1_001 },
    ]) {
      await assert.rejects(
        () => runUnifiedReconciliation({ rootDir: root, jobs: [job], invokeReconciliation, ...options }),
        /exceeds maximum/iu,
      );
    }
    const oversized = {
      ...job,
      packet: { ...job.packet, correctionRules: ["x".repeat(20_000_001)] },
    } as ReconciliationChunkJob;
    await assert.rejects(
      () => runUnifiedReconciliation({ rootDir: root, jobs: [oversized], invokeReconciliation }),
      /prompt exceeded bound/iu,
    );
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("atomic publication preserves the prior target and cleans interrupted temp files", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-atomic-"));
  const target = join(root, "reconciliation/session_000.json");
  try {
    const canonical = validateReconciliationOutput(response(), job);
    await writeCanonicalReconciliationAtomic(target, canonical);
    const original = await readFile(target, "utf8");
    const replacement = {
      ...canonical,
      blocks: canonical.blocks.map((block: (typeof canonical.blocks)[number]) => ({
        ...block,
        text: "Replacement.",
      })),
    };
    await assert.rejects(
      () => writeCanonicalReconciliationAtomic(target, replacement, {
        beforeRename: () => {
          throw new Error("interrupted before publish");
        },
      }),
      /interrupted before publish/iu,
    );
    assert.equal(await readFile(target, "utf8"), original);
    assert.deepEqual(
      (await readdir(dirname(target))).filter((name) => name.endsWith(".tmp")),
      [],
    );
    await writeCanonicalReconciliationAtomic(target, replacement);
    assert.match(await readFile(target, "utf8"), /Replacement\./u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic joined-text publication preserves prior bytes and cleans interruption debris", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-text-atomic-"));
  const target = join(root, "reconciled_transcript.md");
  try {
    await writeFile(target, "prior\n");
    await assert.rejects(
      () => writeReconciliationTextAtomic(target, "replacement\n", {
        beforeRename: () => { throw new Error("interrupted derivative publish"); },
      }),
      /interrupted derivative publish/iu,
    );
    assert.equal(await readFile(target, "utf8"), "prior\n");
    assert.deepEqual((await readdir(root)).filter((name) => name.endsWith(".tmp")), []);
    await writeReconciliationTextAtomic(target, "replacement\n");
    assert.equal(await readFile(target, "utf8"), "replacement\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bounded Hermes handles an already-aborted signal and kills a TERM-ignoring descendant group with the requested cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-hermes-"));
  const command = join(root, "synthetic-hermes.mjs"); const marker = join(root, "cwd.txt"); const pidFile = join(root, "child.pid");
  try {
    await writeFile(command, `#!/usr/bin/env node\nimport { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, process.cwd());\nconst child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });\nwriteFileSync(${JSON.stringify(pidFile)}, String(child.pid));\nsetInterval(()=>{},1000);\n`); await chmod(command, 0o755);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(() => boundedHermes(job, "x", aborted.signal, { timeoutMs: 100, maxOutputBytes: 1000, hermesCommand: command, maxTurns: 1, repositoryCwd: root }), /aborted/iu);
    const started = Date.now(); await assert.rejects(() => boundedHermes(job, "x", new AbortController().signal, { timeoutMs: 100, maxOutputBytes: 1000, hermesCommand: command, maxTurns: 1, repositoryCwd: root }), /timed out|failed/iu); assert.ok(Date.now() - started < 1000);
    const readyDeadline = Date.now() + 300; while (Date.now() < readyDeadline) { try { await access(marker); await access(pidFile); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } }
    assert.equal(await readFile(marker, "utf8"), root); const pid = Number(await readFile(pidFile, "utf8")); const deadline = Date.now() + 500;
    while (Date.now() < deadline) { try { process.kill(pid, 0); const stat = await readFile(`/proc/${pid}/stat`, "utf8"); if (stat.split(" ")[2] === "Z") break; await new Promise((resolve) => setTimeout(resolve, 10)); } catch { break; } } try { const stat = await readFile(`/proc/${pid}/stat`, "utf8"); assert.equal(stat.split(" ")[2], "Z"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bounded Hermes settles during TERM grace when the owned group exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-hermes-cooperative-"));
  const command = join(root, "cooperative-hermes.mjs");
  try {
    await writeFile(command, "#!/usr/bin/env node\nsetInterval(()=>{},1000);\n");
    await chmod(command, 0o755);
    const started = Date.now();
    await assert.rejects(
      () => boundedHermes(job, "x", new AbortController().signal, {
        timeoutMs: 20,
        maxOutputBytes: 1_000,
        hermesCommand: command,
        maxTurns: 1,
        repositoryCwd: root,
      }),
      /timed out/iu,
    );
    assert.ok(Date.now() - started < 250);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded Hermes supplies large prompts through an owner-only temporary file and cleans it", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-hermes-prompt-file-"));
  const command = join(root, "prompt-file-hermes.mjs");
  const marker = join(root, "prompt-marker.json");
  const largePrompt = "evidence:" + "x".repeat(220_000);
  try {
    const relativePromptDir = `relative-prompt-${process.pid}-${Date.now()}`;
    await assert.rejects(() => boundedHermes(job, largePrompt, new AbortController().signal, {
      timeoutMs: 2_000,
      maxOutputBytes: 10_000,
      hermesCommand: command,
      maxTurns: 1,
      repositoryCwd: root,
      promptDir: relativePromptDir,
    }), /absolute path/iu);
    await assert.rejects(access(join(process.cwd(), relativePromptDir)), { code: "ENOENT" });
    await assert.rejects(() => boundedHermes(job, largePrompt, new AbortController().signal, {
      timeoutMs: 2_000,
      maxOutputBytes: 10_000,
      hermesCommand: join(root, "missing-hermes"),
      maxTurns: 1,
      repositoryCwd: root,
      promptDir: root,
    }), /ENOENT|spawn/iu);
    assert.deepEqual((await readdir(root)).filter((name) => name.includes("reconciliation-prompt")), []);
    await writeFile(command, `#!/usr/bin/env node\nimport { readFileSync, statSync, writeFileSync } from "node:fs";\nconst query = process.argv.at(-1);\nconst promptPath = JSON.parse(query.slice(query.lastIndexOf(": ") + 2));\nconst prompt = readFileSync(promptPath, "utf8");\nwriteFileSync(${JSON.stringify(marker)}, JSON.stringify({ query, prompt, mode: statSync(promptPath).mode & 0o777 }));\nprocess.stdout.write(${JSON.stringify(JSON.stringify(response()))});\n`);
    await chmod(command, 0o755);
    const result = await boundedHermes(job, largePrompt, new AbortController().signal, {
      timeoutMs: 2_000,
      maxOutputBytes: 10_000,
      hermesCommand: command,
      maxTurns: 1,
      repositoryCwd: root,
      promptDir: root,
    });
    assert.deepEqual(JSON.parse(result.stdout), response());
    const observed = JSON.parse(await readFile(marker, "utf8")) as { query: string; prompt: string; mode: number };
    assert.equal(observed.prompt, largePrompt);
    assert.equal(observed.mode, 0o600);
    assert.ok(Buffer.byteLength(observed.query, "utf8") < 4_096);
    assert.doesNotMatch(observed.query, /evidence:x{100}/u);
    assert.deepEqual((await readdir(root)).filter((name) => name.includes("reconciliation-prompt")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pending output without a sanitizer is durable but cannot checkpoint, and diagnostics are bounded/sanitized", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-safety-")); let checkpoints = 0;
  try { const pending = response() as any; pending.blocks[0].summarySafeText = ""; pending.summarySafety = { status: "pending", errors: ["unsafe"] }; await assert.rejects(() => runUnifiedReconciliation({ rootDir: root, jobs: [job], maxOutputBytes: 1200, invokeReconciliation: async () => ({ stdout: JSON.stringify(pending), metadata: { token: "m", password: "p", model: "safe" } }), checkpoint: () => { checkpoints += 1; } }), PendingSummarySafetyError); assert.equal(checkpoints, 0); const diagnostics = await Promise.all((await readdir(join(root, "diagnostics"))).map((name) => readFile(join(root, "diagnostics", name), "utf8"))); const diagnostic = diagnostics.join("\n"); assert.doesNotMatch(diagnostic, /token|password/iu); assert.match(diagnostic, /model/iu); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("successful reconciliation requires its raw diagnostic to publish before canonical JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-diagnostic-custody-"));
  try {
    await assert.rejects(
      () => runUnifiedReconciliation({
        rootDir: root,
        jobs: [job],
        invokeReconciliation: async () => JSON.stringify(response()),
        diagnosticWriter: async () => {
          throw new Error("diagnostic disk full");
        },
      }),
      /diagnostic disk full/iu,
    );
    await assert.rejects(() => access(join(root, "reconciliation/session_000.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed run removes stale joined derivatives and diagnostic failure never replaces the primary error", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-stale-"));
  try { await Promise.all(["reconciled_transcript.md", "summary_transcript.md", "reconciliation_review_queue.md"].map((name) => writeFile(join(root, name), "stale"))); const primary = new Error("primary reconciliation failure"); await assert.rejects(() => runUnifiedReconciliation({ rootDir: root, jobs: [job], force: true, invokeReconciliation: async () => { throw primary; }, diagnosticWriter: async () => { throw new Error("disk full"); } }), /primary reconciliation failure.*diagnostic recording failed/iu); await assert.rejects(() => access(join(root, "summary_transcript.md"))); await assert.rejects(() => access(join(root, "reconciled_transcript.md"))); await assert.rejects(() => access(join(root, "reconciliation_review_queue.md"))); }
  finally { await rm(root, { recursive: true, force: true }); }
});
