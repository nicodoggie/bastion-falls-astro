import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { SUMMARY_REPAIR_VERSION, SUMMARY_REPAIR_BOUNDS, buildSummaryRepairPrompt, classifySummaryRepair, normalizeSummaryRepairIssues } from "./reconciliationSummaryRepair.js";
import { SUMMARY_CONTRACT_VERSION, buildChunkContract, buildSceneContract, buildSessionContract, contractFor } from "./reconciliationSummary.js";

test("contracts and repair version are deterministic and complete", () => {
  assert.equal(SUMMARY_CONTRACT_VERSION, "summary-contract.v1");
  assert.equal(SUMMARY_REPAIR_VERSION, "summary-repair.v1");
  for (const [level, fields] of Object.entries({ chunk: ["summary.chunk.v1", "reconciliationBlockIds", "blockIds", "hooks", "sourceReviewDispositions"], scene: ["summary.scene.v1", "chunkClaimProvenance", "chunkHookIds"], session: ["summary.session.v1", "provenanceMap", "promptVersion"] })) {
    const contract = contractFor(level as "chunk" | "scene" | "session");
    assert.equal(contract, contractFor(level as "chunk" | "scene" | "session"));
    for (const field of fields) assert.match(contract, new RegExp(field));
  }
  assert.equal(buildChunkContract(), contractFor("chunk"));
  assert.equal(buildSceneContract(), contractFor("scene"));
  assert.equal(buildSessionContract(), contractFor("session"));
});

test("repair feedback is bounded, normalized, and private-safe", () => {
  const error = new z.ZodError([{ code: "invalid_value", path: ["claims", "x".repeat(500)], message: "secret /home/ensu/private transcript" } as never]);
  const issues = normalizeSummaryRepairIssues(error);
  assert.equal(issues.length, 1);
  assert.ok(issues[0]!.path[1]!.length <= SUMMARY_REPAIR_BOUNDS.maxPathSegment);
  assert.ok(issues[0]!.message.length <= SUMMARY_REPAIR_BOUNDS.maxMessage);
  const prompt = buildSummaryRepairPrompt({ level: "chunk", contract: buildChunkContract(), originalResponse: "secret /home/ensu/private transcript", issues, authoritativeDomains: ["b0"] });
  assert.doesNotMatch(prompt, /\/home\/ensu\/private|secret \/home/iu);
  assert.ok(Buffer.byteLength(prompt) <= SUMMARY_REPAIR_BOUNDS.maxPromptBytes);
});

test("stable categories distinguish repairable validation from operational failures", () => {
  assert.equal(classifySummaryRepair(new z.ZodError([])).eligible, true);
  assert.equal(classifySummaryRepair(Object.assign(new Error("timeout"), { repairCategory: "timeout" })).eligible, false);
  assert.equal(classifySummaryRepair(Object.assign(new Error("empty"), { repairCategory: "empty-output" })).eligible, false);
});
