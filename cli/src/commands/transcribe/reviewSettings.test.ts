import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLogicalChunks, parseReconciliationProvider, parseReviewProvider, resolveReconciliationSettings, resolveReviewSettings } from "./reviewSettings.js";

test("parses supported providers and layouts", () => {
  assert.equal(parseReconciliationProvider("hermes"), "hermes");
  assert.equal(parseReconciliationProvider("legacy"), "legacy");
  assert.equal(parseLogicalChunks("three"), "three");
  assert.throws(() => parseReconciliationProvider("codex"), /Unsupported reconciliation provider/);
  assert.throws(() => parseLogicalChunks("many"), /Unsupported reconciliation logicalChunks/);
});

test("new reconciliation defaults to one hermes chunk", () => {
  assert.deepEqual(resolveReconciliationSettings(undefined), { provider: "hermes", logicalChunks: "single", hermesProfile: "default", hermesMaxTurns: 12, promptVersion: "reconciliation.prompt.v3", schemaVersion: "reconciliation.v1", source: "default" });
});

test("CLI reconciliation settings override configuration", () => {
  assert.deepEqual(resolveReconciliationSettings({ provider: "off", logicalChunks: "three", hermes: { profile: "configured", maxTurns: 4 } }, { provider: "hermes", logicalChunks: "single", hermesProfile: "cli", hermesMaxTurns: 7 }), { provider: "hermes", logicalChunks: "single", hermesProfile: "cli", hermesMaxTurns: 7, promptVersion: "reconciliation.prompt.v3", schemaVersion: "reconciliation.v1", source: "cli" });
});

test("deprecated review config maps hermes to explicit legacy only when no new settings exist", () => {
  assert.equal(resolveReconciliationSettings(undefined, {}, { provider: "hermes" }).provider, "legacy");
  assert.equal(resolveReconciliationSettings(undefined, { provider: undefined, logicalChunks: undefined }, { provider: "hermes" }).provider, "legacy");
  assert.equal(resolveReconciliationSettings(undefined, { provider: "hermes" }, { provider: "hermes" }).provider, "hermes");
});

test("uses command-line review provider before project configuration", () => {
  assert.deepEqual(resolveReviewSettings({ provider: "hermes", hermes: { profile: "reviewer" } }, { provider: "off" }), { provider: "off", hermesProfile: "reviewer", hermesMaxTurns: 12 });
});

test("uses project review provider before the disabled default", () => {
  assert.deepEqual(resolveReviewSettings({ provider: "hermes" }), { provider: "hermes", hermesProfile: undefined, hermesMaxTurns: 12 });
  assert.deepEqual(resolveReviewSettings(undefined), { provider: "off", hermesProfile: undefined, hermesMaxTurns: 12 });
});

test("uses command-line Hermes profile before project configuration", () => {
  assert.deepEqual(resolveReviewSettings({ provider: "hermes", hermes: { profile: "configured" } }, { hermesProfile: "override", hermesMaxTurns: 7 }), { provider: "hermes", hermesProfile: "override", hermesMaxTurns: 7 });
});

test("rejects malformed review configuration", () => {
  assert.throws(() => resolveReviewSettings("hermes"), /transcribe\.review must be an object/);
  assert.throws(() => resolveReviewSettings({ provider: "hermes", hermes: "default" }), /transcribe\.review\.hermes must be an object/);
  assert.throws(() => resolveReviewSettings({ provider: "hermes", hermes: { profile: 42 } }), /transcribe\.review\.hermes\.profile must be a string/);
  assert.throws(() => resolveReconciliationSettings({ hermes: { maxTurns: 0 } }), /maxTurns must be a bounded positive integer/);
  assert.throws(() => resolveReconciliationSettings({ provider: "hermes", surprise: true }), /unsupported keys/);
  assert.throws(() => resolveReconciliationSettings({ provider: "hermes", hermes: { maxTurns: 1001 } }), /bounded positive integer/);
});
