import { test } from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableHash } from "./reconciliationEvidence.js";
import { ChunkSummarySchema, SceneSummarySchema, SessionSummarySchema, atomicJson, parseChunkSummary, parseSceneSummary, parseSessionSummary, buildChunkSummaryPrompt, runBoundedCodexCommand, runReconciliationSummarization, renderSessionMdx, type ChunkSummary, type SceneSummary } from "./reconciliationSummary.js";

const canonical = { chunk: { id: "session_000", start: 0, end: 10 }, blocks: [
  { id: "b0", start: 0, end: 5, kind: "dialogue", text: "We go north.", summarySafeText: "They go north.", characterConfidence: "confirmed", characterCandidate: "Ada", attributionBasis: ["explicit"], sourceEventIds: ["e0"], reviewFlags: ["unclear-words"] },
  { id: "b1", start: 5, end: 10, kind: "narration", text: "The door opens.", summarySafeText: "A door opens.", characterConfidence: "unknown", attributionBasis: ["narration"], sourceEventIds: ["e1"], reviewFlags: [] },
], suspicionFlags: [], reviewNotes: [] };
const identity = stableHash("fixture");
const chunk: ChunkSummary = { cacheIdentity: identity, schemaVersion: "summary.chunk.v1", chunkId: "session_000", sourceSuspicionFlags: [], reviewNotes: [], sourceReviewTargets: [], claims: [{ id: "claim-0", text: "The party goes north.", reconciliationBlockIds: ["b0"], confidence: "high", attribution: "Ada", originalReviewFlags: ["unclear-words"] }], unresolvedHooks: [{ id: "hook-0", text: "What is behind the door?", reconciliationBlockIds: ["b1"], originalReviewFlags: [] }], reviewDispositions: [{ targetId: "claim-0", disposition: "carried_as_uncertain", originalReviewFlags: ["unclear-words"] }, { targetId: "hook-0", disposition: "resolved_for_summary", originalReviewFlags: [] }], nextRollingContext: "The party is heading north; a door opened." };
function response(id: string, prior = ""): ChunkSummary { return { ...chunk, chunkId: id, claims: chunk.claims.map((x) => ({ ...x, id: `${id}-${x.id}` })), unresolvedHooks: chunk.unresolvedHooks.map((x) => ({ ...x, id: `${id}-${x.id}` })), reviewDispositions: chunk.reviewDispositions.map((x) => ({ ...x, targetId: `${id}-${x.targetId}` })), nextRollingContext: prior ? `${prior} next` : chunk.nextRollingContext }; }
function sceneFor(chunks: readonly ChunkSummary[]): SceneSummary { return { cacheIdentity: identity, schemaVersion: "summary.scene.v1", sceneId: "scene_000", chunkIds: chunks.map((x) => x.chunkId), claims: chunks.flatMap((x) => x.claims.map((c) => ({ id: `scene-${c.id}`, text: c.text, chunkClaimIds: [c.id] }))), unresolvedHooks: chunks.flatMap((x) => x.unresolvedHooks.map((h) => ({ id: `scene-${h.id}`, text: h.text, chunkHookIds: [h.id] }))), chunkClaimProvenance: Object.fromEntries(chunks.flatMap((x) => x.claims.map((c) => [c.id, c.reconciliationBlockIds]))) }; }

test("strict chunk parse validates provenance, source dispositions, and unknown blocks", () => { assert.equal(parseChunkSummary(chunk, canonical).chunkId, "session_000"); assert.throws(() => parseChunkSummary({ ...chunk, extra: true }, canonical)); assert.throws(() => parseChunkSummary({ ...chunk, claims: [{ ...chunk.claims[0]!, reconciliationBlockIds: ["missing"] }] }, canonical)); assert.throws(() => parseChunkSummary({ ...chunk, reviewDispositions: chunk.reviewDispositions.slice(0, 1) }, canonical)); });
test("prompt is deterministic and includes evidence, prompt version, context, flags, alternatives and rules", () => { const options = { canonical, promptVersion: "p7", priorRollingContext: "Prior", campaignContext: "Campaign", correctionRules: ["Ada is a name"], flaggedAlternatives: [{ blockId: "b0", alternatives: ["We go north"] }] }; const a = buildChunkSummaryPrompt(options); assert.equal(a, buildChunkSummaryPrompt(options)); for (const value of ["summarySafeText", "p7", "Prior", "Campaign", "Ada is a name", "unclear-words", "We go north"]) assert.match(a, new RegExp(value)); });
test("long correction rules remain intact within the evidence-text bound", () => { const rule = `Long rule: ${"evidence ".repeat(80)}`.trim(); assert.equal(rule.length > 400, true); const prompt = buildChunkSummaryPrompt({ canonical, promptVersion: "p7", correctionRules: [rule] }); assert.match(prompt, new RegExp(rule)); });
test("runner writes direct canonical JSON and zero-call resume", async () => { const root = await mkdtemp(join(tmpdir(), "reconciliation-summary-")); let calls = 0; const priors: string[] = []; const options = { outputRoot: root, chunks: [canonical as any, { ...canonical, chunk: { ...canonical.chunk, id: "session_001" } } as any], provider: "test", promptVersion: "p1", campaignContext: "c", correctionRules: [], infer: async ({ priorRollingContext }: { priorRollingContext: string }) => { calls++; priors.push(priorRollingContext); return response(calls === 1 ? "session_000" : "session_001", priorRollingContext); }, sceneInfer: async ({ chunks }: { chunks: readonly ChunkSummary[] }) => sceneFor(chunks), sessionInfer: async ({ scenes }: { scenes: readonly SceneSummary[] }) => { const all = scenes.flatMap((s) => s.claims); return { schemaVersion: "summary.session.v1", claims: all.map((c) => ({ id: `final-${c.id}`, text: c.text, sceneClaimIds: [c.id] })), sections: [], openHooks: scenes.flatMap((s) => s.unresolvedHooks.map((h) => ({ id: `open-${h.id}`, text: h.text, sceneHookIds: [h.id] }))), confirmationsNeeded: [], boundaries: [], provenanceMap: Object.fromEntries(all.map((c) => [`final-${c.id}`, [c.id, ...c.chunkClaimIds, "b0"]])), campaign: "demo", sessionDate: "2026-08-19" }; } }; const first = await runReconciliationSummarization(options); assert.equal(calls, 2); assert.deepEqual(priors, ["", chunk.nextRollingContext]); const disk = JSON.parse(await readFile(join(root, "summarization", "chunks", "session_000.json"), "utf8")); assert.equal(disk.schemaVersion, "summary.chunk.v1"); assert.equal(disk.artifact, undefined); assert.equal(disk.cacheIdentity.length, 64); await runReconciliationSummarization(options); assert.equal(calls, 2); assert.equal(first.session.claims.length, 2); assert.deepEqual((await readdir(join(root, "summarization", "chunks"))).sort(), ["session_000.json", "session_001.json"]); });
test("scene/session complete provenance and deterministic MDX", () => { const scene = sceneFor([chunk]); parseSceneSummary(scene, [chunk]); assert.throws(() => parseSceneSummary({ ...scene, claims: [] }, [chunk]), /represent every included chunk claim/iu); assert.throws(() => parseSceneSummary({ ...scene, unresolvedHooks: [] }, [chunk]), /represent every included chunk hook/iu); const session = { cacheIdentity: identity, promptVersion: "p1", schemaVersion: "summary.session.v1", claims: [{ id: "final-0", text: "Travel north continues.", sceneClaimIds: ["scene-claim-0"] }], sections: [], openHooks: [{ id: "open-0", text: "What is behind the door?", sceneHookIds: ["scene-hook-0"] }], confirmationsNeeded: [], boundaries: [], provenanceMap: { "final-0": ["scene-claim-0", "claim-0", "b0"] }, campaign: "demo", sessionDate: "2026-08-19" }; assert.match(renderSessionMdx(session, [scene]), /## Open Hooks/); assert.throws(() => parseSessionSummary({ ...session, provenanceMap: { "final-0": ["scene-claim-0"] } }, [scene])); });

test("empty initial output is operational and cannot trigger repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-empty-output-"));
  let calls = 0;
  try {
    await assert.rejects(() => runReconciliationSummarization({
      outputRoot: root,
      chunks: [canonical as any],
      promptVersion: "p1",
      infer: async () => { calls += 1; return ""; },
    }), /empty output/iu);
    assert.equal(calls, 1);
    await assert.rejects(() => access(join(root, "summarization/chunks/session_000.json")));
    await assert.rejects(() => access(join(root, "summarization/diagnostics/chunk-session_000-repair.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repair prompt receives bounded authoritative domains", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-authority-"));
  const prompts: string[] = [];
  try {
    await runReconciliationSummarization({
      outputRoot: root, chunks: [canonical as any], promptVersion: "p1",
      infer: async ({ prompt }) => { prompts.push(prompt); if (prompts.length === 1) return { blockIds: ["b0"] }; return response("session_000"); },
      sceneInfer: async ({ chunks }) => sceneFor(chunks),
      sessionInfer: async ({ scenes }) => { const claims = scenes.flatMap((s) => s.claims); const hooks = scenes.flatMap((s) => s.unresolvedHooks); return { schemaVersion: "summary.session.v1", claims: claims.map((c) => ({ id: `final-${c.id}`, text: c.text, sceneClaimIds: [c.id] })), sections: [], openHooks: hooks.map((h) => ({ id: `open-${h.id}`, text: h.text, sceneHookIds: [h.id] })), confirmationsNeeded: [], boundaries: [], provenanceMap: Object.fromEntries(claims.map((c) => [`final-${c.id}`, [c.id, ...c.chunkClaimIds, "b0"]])), campaign: "demo", sessionDate: "2026-08-19" }; },
    });
    assert.equal(prompts.length, 2);
    assert.match(prompts[1]!, /b0/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("source suspicion flags and duplicate review notes remain disposition-addressable", () => {
  const reviewedCanonical = {
    ...canonical,
    suspicionFlags: ["large-compression"],
    reviewNotes: ["same note", "same note"],
  } as any;
  const sourceReviewTargets = [
    { id: `suspicion:${stableHash("large-compression")}:0`, kind: "suspicion-flag", text: "large-compression", originalReviewFlags: [] },
    { id: `review-note:${stableHash("same note")}:0`, kind: "review-note", text: "same note", originalReviewFlags: [] },
    { id: `review-note:${stableHash("same note")}:1`, kind: "review-note", text: "same note", originalReviewFlags: [] },
  ] as const;
  const reviewed = {
    ...chunk,
    sourceSuspicionFlags: ["large-compression"],
    reviewNotes: ["same note", "same note"],
    sourceReviewTargets,
    reviewDispositions: [
      ...chunk.reviewDispositions,
      ...sourceReviewTargets.map((target) => ({ targetId: target.id, disposition: "requires_human_review" as const, originalReviewFlags: [] })),
    ],
  };
  assert.doesNotThrow(() => parseChunkSummary(reviewed, reviewedCanonical));
  assert.throws(
    () => parseChunkSummary({ ...reviewed, reviewDispositions: reviewed.reviewDispositions.slice(0, -1) }, reviewedCanonical),
    /missing durable disposition/iu,
  );
});

test("runner injects canonical source review material while the model owns dispositions", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-source-review-"));
  const reviewedCanonical = { ...canonical, suspicionFlags: ["large-compression"], reviewNotes: ["same note"] } as any;
  const sourceReviewTargets = [
    { id: `suspicion:${stableHash("large-compression")}:0`, kind: "suspicion-flag", text: "large-compression", originalReviewFlags: [] },
    { id: `review-note:${stableHash("same note")}:0`, kind: "review-note", text: "same note", originalReviewFlags: [] },
  ] as const;
  try {
    const result = await runReconciliationSummarization({
      outputRoot: root, chunks: [reviewedCanonical], provider: "test", promptVersion: "p1",
      infer: async ({ prompt }) => {
        for (const target of sourceReviewTargets) assert.match(prompt, new RegExp(target.id));
        const model = response("session_000");
        return {
          ...model,
          sourceSuspicionFlags: undefined,
          reviewNotes: undefined,
          sourceReviewTargets: undefined,
          reviewDispositions: [
            ...model.reviewDispositions,
            ...sourceReviewTargets.map((target) => ({ targetId: target.id, disposition: "requires_human_review" as const, originalReviewFlags: [] })),
          ],
        };
      },
      sceneInfer: async ({ chunks }) => sceneFor(chunks),
      sessionInfer: async ({ scenes }) => {
        const claims = scenes.flatMap((scene) => scene.claims);
        return { schemaVersion: "summary.session.v1", claims: claims.map((claim) => ({ id: `final-${claim.id}`, text: claim.text, sceneClaimIds: [claim.id] })), sections: [], openHooks: scenes.flatMap((scene) => scene.unresolvedHooks.map((hook) => ({ id: `open-${hook.id}`, text: hook.text, sceneHookIds: [hook.id] }))), confirmationsNeeded: [], boundaries: [], provenanceMap: Object.fromEntries(claims.map((claim) => [`final-${claim.id}`, [claim.id, ...claim.chunkClaimIds, "b0"]])), campaign: "demo", sessionDate: "2026-08-29" };
      },
    });
    assert.deepEqual(result.chunks[0]!.sourceReviewTargets, sourceReviewTargets);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical summary files parse directly and prompt versions invalidate all levels", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-canonical-cache-"));
  let chunkCalls = 0; let sceneCalls = 0; let sessionCalls = 0;
  const makeOptions = (promptVersion: string) => ({
    outputRoot: root,
    chunks: [canonical as any],
    provider: "test",
    promptVersion,
    campaign: "demo",
    sessionDate: "2026-08-19",
    infer: async () => { chunkCalls += 1; return response("session_000"); },
    sceneInfer: async ({ chunks }: { chunks: readonly ChunkSummary[] }) => { sceneCalls += 1; return sceneFor(chunks); },
    sessionInfer: async ({ scenes }: { scenes: readonly SceneSummary[] }) => {
      sessionCalls += 1;
      const claims = scenes.flatMap((scene) => scene.claims);
      return {
        schemaVersion: "summary.session.v1",
        claims: claims.map((claim) => ({ id: `final-${claim.id}`, text: claim.text, sceneClaimIds: [claim.id] })),
        sections: [],
        openHooks: scenes.flatMap((scene) => scene.unresolvedHooks.map((hook) => ({ id: `open-${hook.id}`, text: hook.text, sceneHookIds: [hook.id] }))),
        confirmationsNeeded: [], boundaries: [],
        provenanceMap: Object.fromEntries(claims.map((claim) => [`final-${claim.id}`, [claim.id, ...claim.chunkClaimIds, "b0"]])),
        campaign: "demo", sessionDate: "2026-08-19",
      };
    },
  });
  try {
    await runReconciliationSummarization(makeOptions("p1"));
    ChunkSummarySchema.parse(JSON.parse(await readFile(join(root, "summarization/chunks/session_000.json"), "utf8")));
    SceneSummarySchema.parse(JSON.parse(await readFile(join(root, "summarization/scenes/scene_000.json"), "utf8")));
    SessionSummarySchema.parse(JSON.parse(await readFile(join(root, "summarization/session.json"), "utf8")));
    await runReconciliationSummarization(makeOptions("p1"));
    assert.deepEqual([chunkCalls, sceneCalls, sessionCalls], [1, 1, 1]);
    await runReconciliationSummarization(makeOptions("p2"));
    assert.deepEqual([chunkCalls, sceneCalls, sessionCalls], [2, 2, 2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic summary publication preserves prior bytes and cleans temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-atomic-"));
  const target = join(root, "session_000.json");
  try {
    await atomicJson(target, chunk);
    const original = await readFile(target, "utf8");
    await assert.rejects(
      () => atomicJson(target, { ...chunk, nextRollingContext: "replacement" }, () => { throw new Error("before rename"); }),
      /before rename/iu,
    );
    assert.equal(await readFile(target, "utf8"), original);
    assert.deepEqual((await readdir(root)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded default inference owns cwd, output, overflow, timeout, and descendants", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-codex-lifecycle-"));
  const command = join(root, "synthetic-codex.mjs");
  const childPidPath = join(root, "descendant.pid");
  const parentPidPath = join(root, "parent.pid");
  try {
    await writeFile(command, `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const output = args[args.indexOf("-o") + 1];
const prompt = readFileSync(0, "utf8");
if (prompt === "success") {
  writeFileSync(output, JSON.stringify({ cwd: process.cwd() }));
  process.exit(0);
}
if (prompt === "malformed") {
  writeFileSync(output, "{malformed");
  process.exit(0);
}
if (prompt === "overflow") {
  process.on("SIGTERM", () => {});
  process.stdout.write("x".repeat(20_000));
  setInterval(() => {}, 1_000);
}
if (prompt === "timeout") {
  process.on("SIGTERM", () => {});
  writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid));
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "inherit" });
  writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
  setInterval(() => {}, 1_000);
}
`);
    await chmod(command, 0o755);

    const success = await runBoundedCodexCommand({ prompt: "success", cwd: root, scratch: root, timeoutMs: 500, maxOutputBytes: 1_000, command });
    assert.deepEqual(success, { cwd: root });
    const malformed = await runBoundedCodexCommand({ prompt: "malformed", cwd: root, scratch: root, timeoutMs: 500, maxOutputBytes: 1_000, command });
    assert.equal(malformed, "{malformed");
    await assert.rejects(() => access(join(root, "response.json")));

    const overflowStart = Date.now();
    await assert.rejects(
      () => runBoundedCodexCommand({ prompt: "overflow", cwd: root, scratch: root, timeoutMs: 2_000, maxOutputBytes: 1_000, command }),
      /output exceeds bound/iu,
    );
    assert.ok(Date.now() - overflowStart < 1_000);

    const timeoutStart = Date.now();
    await assert.rejects(
      () => runBoundedCodexCommand({ prompt: "timeout", cwd: root, scratch: root, timeoutMs: 50, maxOutputBytes: 1_000, command }),
      /timed out/iu,
    );
    assert.ok(Date.now() - timeoutStart < 1_000);
    const pid = Number(await readFile(childPidPath, "utf8"));
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        if (stat.split(" ")[2] === "Z") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch { break; }
    }
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      assert.equal(stat.split(" ")[2], "Z");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parentPid = Number(await readFile(parentPidPath, "utf8"));
    assert.throws(() => process.kill(-parentPid, 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function sessionForScenes(scenes: readonly SceneSummary[]): unknown {
  const claims = scenes.flatMap((scene) => scene.claims);
  const hooks = scenes.flatMap((scene) => scene.unresolvedHooks);
  return { schemaVersion: "summary.session.v1", claims: claims.map((claim) => ({ id: `final-${claim.id}`, text: claim.text, sceneClaimIds: [claim.id] })), sections: [], openHooks: hooks.map((hook) => ({ id: `open-${hook.id}`, text: hook.text, sceneHookIds: [hook.id] })), confirmationsNeeded: [], boundaries: [], provenanceMap: Object.fromEntries(claims.map((claim) => { const scene = scenes.find((candidate) => candidate.claims.some((item) => item.id === claim.id))!; return [`final-${claim.id}`, [claim.id, ...claim.chunkClaimIds, ...(scene.chunkClaimProvenance[claim.chunkClaimIds[0]!] ?? [])]]; })), campaign: "demo", sessionDate: "2026-08-19" };
}

test("runner repairs malformed scene output once and publishes a parseable scene before session inference", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-scene-repair-runner-")); let sceneCalls = 0; let sessionCalls = 0; const prompts: string[] = [];
  try {
    const result = await runReconciliationSummarization({ outputRoot: root, chunks: [canonical as any], promptVersion: "p1", infer: async () => response("wrong-id"), sceneInfer: async ({ prompt, chunks }) => { prompts.push(prompt); sceneCalls += 1; return sceneCalls === 1 ? { malformed: true } : { ...sceneFor(chunks), sceneId: "wrong-id" }; }, sessionInfer: async ({ scenes }) => { sessionCalls += 1; return sessionForScenes(scenes); } });
    assert.equal(sceneCalls, 2); assert.equal(sessionCalls, 1); assert.match(prompts[1]!, /This is the only repair attempt/u); assert.equal(parseSceneSummary(JSON.parse(await readFile(join(root, "summarization/scenes/scene_000.json"), "utf8")), [result.chunks[0]!]).sceneId, "scene_000");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runner repairs malformed session output once and publishes a parseable session", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-session-repair-runner-")); let sessionCalls = 0;
  try {
    const result = await runReconciliationSummarization({ outputRoot: root, chunks: [canonical as any], promptVersion: "p1", infer: async () => response("session_000"), sceneInfer: async ({ chunks }) => sceneFor(chunks), sessionInfer: async ({ scenes }) => { sessionCalls += 1; return sessionCalls === 1 ? { malformed: true } : sessionForScenes(scenes); } });
    assert.equal(sessionCalls, 2); assert.equal(parseSessionSummary(JSON.parse(await readFile(join(root, "summarization/session.json"), "utf8")), result.scenes).schemaVersion, "summary.session.v1");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid repair publishes no artifact and invalid scene repair blocks session inference", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-invalid-repair-runner-")); let calls = 0;
  try { await assert.rejects(() => runReconciliationSummarization({ outputRoot: root, chunks: [canonical as any], promptVersion: "p1", infer: async () => { calls += 1; return {}; } })); assert.equal(calls, 2); await assert.rejects(() => access(join(root, "summarization/chunks/session_000.json"))); await assert.rejects(() => access(join(root, "summarization/session.json"))); } finally { await rm(root, { recursive: true, force: true }); }
  const sceneRoot = await mkdtemp(join(tmpdir(), "summary-invalid-scene-repair-runner-")); let sceneCalls = 0; let sessionCalls = 0;
  try { await assert.rejects(() => runReconciliationSummarization({ outputRoot: sceneRoot, chunks: [canonical as any], promptVersion: "p1", infer: async () => response("session_000"), sceneInfer: async () => { sceneCalls += 1; return {}; }, sessionInfer: async () => { sessionCalls += 1; return sessionForScenes([]); } })); assert.equal(sceneCalls, 2); assert.equal(sessionCalls, 0); await assert.rejects(() => access(join(sceneRoot, "summarization/scenes/scene_000.json"))); await assert.rejects(() => access(join(sceneRoot, "summarization/session.json"))); } finally { await rm(sceneRoot, { recursive: true, force: true }); }
});

test("runner does not repair stable operational failures or publish artifacts", async () => {
  for (const category of ["timeout", "abort", "output-overflow", "identity", "custody"] as const) { const root = await mkdtemp(join(tmpdir(), `summary-${category}-runner-`)); let calls = 0; try { await assert.rejects(() => runReconciliationSummarization({ outputRoot: root, chunks: [canonical as any], promptVersion: "p1", infer: async () => { calls += 1; throw Object.assign(new Error(`private secret /home/ensu/transcript-${category}`), { repairCategory: category }); } })); assert.equal(calls, 1, category); await assert.rejects(() => access(join(root, "summarization/chunks/session_000.json")), category); await assert.rejects(() => access(join(root, "summarization/session.json")), category); } finally { await rm(root, { recursive: true, force: true }); } }
});

test("eligible runner attempts write 0600 diagnostics, while ordinary errors do not", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-diagnostics-runner-"));
  try { let calls = 0; await assert.rejects(() => runReconciliationSummarization({ outputRoot: root, chunks: [canonical as any], promptVersion: "p1", infer: async () => { calls += 1; return calls === 1 ? "secret /home/ensu/transcript" : "still malformed"; } })); for (const name of ["chunk-session_000-initial.json", "chunk-session_000-repair.json"]) assert.equal((await stat(join(root, "summarization/diagnostics", name))).mode & 0o777, 0o600);
    const ordinaryRoot = await mkdtemp(join(tmpdir(), "summary-ordinary-error-runner-")); let ordinaryCalls = 0; try { await assert.rejects(() => runReconciliationSummarization({ outputRoot: ordinaryRoot, chunks: [canonical as any], promptVersion: "p1", infer: async () => { ordinaryCalls += 1; throw new Error("secret /home/ensu/private transcript marker"); } })); assert.equal(ordinaryCalls, 1); await assert.rejects(() => access(join(ordinaryRoot, "summarization/diagnostics"))); } finally { await rm(ordinaryRoot, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runner overwrites model-owned caller IDs on both initial and repair attempts", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-caller-ids-runner-")); let calls = 0;
  try { const result = await runReconciliationSummarization({ outputRoot: root, chunks: [canonical as any], promptVersion: "p1", infer: async () => { calls += 1; return calls === 1 ? { malformed: true, chunkId: "model-initial" } : { ...response("model-repair"), chunkId: "model-repair" }; }, sceneInfer: async ({ chunks }) => sceneFor(chunks), sessionInfer: async ({ scenes }) => sessionForScenes(scenes) }); assert.equal(calls, 2); assert.equal(result.chunks[0]!.chunkId, "session_000"); assert.equal(JSON.parse(await readFile(join(root, "summarization/chunks/session_000.json"), "utf8")).chunkId, "session_000"); } finally { await rm(root, { recursive: true, force: true }); }
});

test("unsupported model-owned provenance after repair remains rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "summary-provenance-repair-runner-")); let calls = 0;
  try { await assert.rejects(() => runReconciliationSummarization({ outputRoot: root, chunks: [canonical as any], promptVersion: "p1", infer: async () => { calls += 1; return calls === 1 ? { malformed: true } : { ...response("session_000"), claims: [{ ...response("session_000").claims[0]!, reconciliationBlockIds: ["unsupported-model-ref"] }] }; } })); assert.equal(calls, 2); await assert.rejects(() => access(join(root, "summarization/chunks/session_000.json"))); } finally { await rm(root, { recursive: true, force: true }); }
});
