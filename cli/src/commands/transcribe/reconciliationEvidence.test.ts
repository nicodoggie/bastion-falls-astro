import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidencePacket, buildReconciliationCacheIdentity, selectOwnedAlignmentEvents, stableHash, assignStableEventId } from "./reconciliationEvidence.js";

const alignment = { version: 1 as const, events: [
  { text: "tail", sourcePass: "right", globalStart: 9, globalEnd: 11, confidence: .5, channel: "right", physicalSpeaker: "GM", alternatives: [{ text: "tail", sourcePass: "right", channel: "right", confidence: .5, relativeEnergy: .2, globalStart: 9, globalEnd: 11 }] },
  { text: "owned", sourcePass: "left", globalStart: 10, globalEnd: 12, confidence: .9, channel: "left", physicalSpeaker: "Andrew", alternatives: [{ text: "owned", sourcePass: "left", channel: "left", confidence: .9, relativeEnergy: .8, globalStart: 10, globalEnd: 12 }] },
  { text: "next", sourcePass: "stereo", globalStart: 19, globalEnd: 21, alternatives: [] },
] };
const base = { sourceHash: "a".repeat(64), alignment, logicalStart: 10, logicalEnd: 20, chunkIndex: 2, previousReadableTail: ["previous"], nextAlignmentHead: [alignment.events[2]!], channelMap: { version: 1 as const, source: "audio", channels: [{ id: "left", index: 0, speakers: [{ name: "Andrew", role: "player" as const, expectedCharacters: [{ name: "Andrew", aliases: [] }] }] }] }, glossary: ["Bastion"], correctionRules: ["rule"], campaign: "Bastion", sessionDate: "2026-08-15", provider: { provider: "hermes", model: "m", profile: "p" }, promptVersion: "prompt.v1", schemaVersion: "reconciliation.v1", evidenceRevision: "r1" };

test("default prompt identity tracks the current reconciliation contract", () => {
  const { promptVersion: _promptVersion, ...withoutPromptVersion } = base;
  assert.equal(buildEvidencePacket(withoutPromptVersion).promptVersion, "reconciliation.prompt.v4");
});

test("stable IDs and hashes are deterministic without reordering alternatives", () => {
  assert.equal(assignStableEventId(2, 0), "session_002:event_0000");
  const a = buildEvidencePacket(base);
  const reordered = { ...base, alignment: { ...alignment, events: alignment.events.map((e) => ({ ...e, alternatives: [...e.alternatives].reverse() })).reverse() } };
  const b = buildEvidencePacket(reordered);
  assert.deepEqual(a.ownedEvents.map((e) => [e.id, e.text]), b.ownedEvents.map((e) => [e.id, e.text]));
  assert.equal(stableHash({ b: 1, a: 2 }), stableHash({ a: 2, b: 1 }));

  const tied = {
    version: 1 as const,
    events: [
      { text: "alpha", sourcePass: "left", globalStart: 10, globalEnd: 12, alternatives: [] },
      { text: "beta", sourcePass: "left", globalStart: 10, globalEnd: 12, alternatives: [] },
    ],
  };
  const tiedForward = selectOwnedAlignmentEvents(tied, 2, 10, 20);
  const tiedReverse = selectOwnedAlignmentEvents(
    { ...tied, events: [...tied.events].reverse() },
    2,
    10,
    20,
  );
  assert.deepEqual(
    tiedForward.map((event) => [event.id, event.text]),
    tiedReverse.map((event) => [event.id, event.text]),
  );

  const exactDuplicate = {
    version: 1 as const,
    events: [tied.events[0]!, structuredClone(tied.events[0]!)],
  };
  assert.throws(
    () => selectOwnedAlignmentEvents(exactDuplicate, 2, 10, 20),
    /duplicate alignment event/iu,
  );
});

test("ownership uses half-open midpoint and clips crossing events without deduping overlap", () => {
  const events = selectOwnedAlignmentEvents(alignment, 2, 10, 20);
  assert.deepEqual(events.map((e) => [e.start, e.end, e.supportedRange]), [[9, 11, { start: 10, end: 11 }], [10, 12, undefined]]);
  assert.equal(buildEvidencePacket(base).context.previousReadableTail[0], "previous");
  assert.equal(buildEvidencePacket(base).ownedEvents.length, 2);
  assert.equal(buildEvidencePacket(base).context.contextOnly, true);
});

test("packet preserves evidence and cache identity changes with meaningful context", () => {
  const packet = buildEvidencePacket(base);
  assert.equal(packet.cacheIdentity.sourceHash, base.sourceHash);
  assert.equal(packet.ownedEvents[1]!.physicalSpeaker, "Andrew");
  assert.equal(packet.ownedEvents[1]!.alternatives[0]!.relativeEnergy, .8);
  assert.deepEqual(packet.expectedCharacters, ["Andrew"]);
  const variants: Array<[string, (value: typeof base) => typeof base]> = [
    ["sourceHash", (value) => ({ ...value, sourceHash: "b".repeat(64) })],
    ["alignment", (value) => ({ ...value, alignment: { ...alignment, events: alignment.events.map((e) => e.text === "owned" ? { ...e, text: "changed" } : e) } })],
    ["logicalStart", (value) => ({ ...value, logicalStart: 11 })], ["logicalEnd", (value) => ({ ...value, logicalEnd: 21 })],
    ["previousReadableTail", (value) => ({ ...value, previousReadableTail: ["changed"] })], ["nextAlignmentHead", (value) => ({ ...value, nextAlignmentHead: [alignment.events[0]!] })],
    ["channelMap", (value) => ({ ...value, channelMap: { ...value.channelMap, source: "other" } })], ["glossary", (value) => ({ ...value, glossary: ["changed"] })],
    ["correctionRules", (value) => ({ ...value, correctionRules: ["changed"] })], ["promptVersion", (value) => ({ ...value, promptVersion: "changed" })],
    ["schemaVersion", (value) => ({ ...value, schemaVersion: "changed" })], ["campaign", (value) => ({ ...value, campaign: "changed" })],
    ["provider", (value) => ({ ...value, provider: { provider: "other", model: "m", profile: "p" } })],
    ["provider model", (value) => ({ ...value, provider: { ...value.provider, model: "other-model" } })],
    ["provider profile", (value) => ({ ...value, provider: { ...value.provider, profile: "other-profile" } })],
    ["sessionDate", (value) => ({ ...value, sessionDate: "2026-08-16" })],
    ["expectedCharacters", (value) => ({ ...value, expectedCharacters: ["Changed"] })],
    ["evidenceRevision", (value) => ({ ...value, evidenceRevision: "changed" })],
  ];
  for (const [key, mutate] of variants) {
    assert.notEqual(buildReconciliationCacheIdentity(mutate(base)).inputHash, buildReconciliationCacheIdentity(base).inputHash, key);
  }
});

test("absent channel map and neighbors are hashable and explicitly context-only", () => {
  assert.doesNotThrow(() => stableHash(undefined));
  assert.equal(stableHash(undefined), stableHash(null));
  assert.equal(stableHash({ optional: undefined }), stableHash({ optional: null }));
  const packet = buildEvidencePacket({ ...base, channelMap: undefined, previousReadableTail: undefined, nextAlignmentHead: undefined });
  assert.deepEqual(packet.context, { contextOnly: true, previousReadableTail: [], nextAlignmentHead: [] });
  assert.doesNotThrow(() => buildReconciliationCacheIdentity({ ...base, channelMap: undefined }));
});

test("exported runtime boundaries reject malformed inputs as one compact adversarial matrix", () => {
  const malformedAlignment = { ...alignment, events: [{ ...alignment.events[0], globalStart: Number.NaN }] };
  const malformedChannelMap = { ...base.channelMap, channels: [{ ...base.channelMap.channels[0], index: -1 }] };
  const cases: Array<[string, unknown]> = [
    ["reversed window", { ...base, logicalStart: 20, logicalEnd: 10 }],
    ["nonfinite window", { ...base, logicalEnd: Number.POSITIVE_INFINITY }],
    ["NaN chunk", { ...base, chunkIndex: Number.NaN }],
    ["fractional chunk", { ...base, chunkIndex: 1.5 }],
    ["negative chunk", { ...base, chunkIndex: -1 }],
    ["oversized chunk", { ...base, chunkIndex: 1_000_001 }],
    ["NaN neighbors", { ...base, neighborLimit: Number.NaN }],
    ["fractional neighbors", { ...base, neighborLimit: 1.5 }],
    ["negative neighbors", { ...base, neighborLimit: -1 }],
    ["oversized neighbors", { ...base, neighborLimit: 65 }],
    ["empty identity", { ...base, sourceHash: "" }],
    ["malformed identity", { ...base, sourceHash: "NOT-A-SHA256" }],
    ["empty provider", { ...base, provider: { provider: "", model: "m" } }],
    ["malformed alignment", { ...base, alignment: malformedAlignment }],
    ["malformed channel map", { ...base, channelMap: malformedChannelMap }],
  ];
  for (const [name, value] of cases) {
    assert.throws(() => buildEvidencePacket(value as never), name);
    assert.throws(() => buildReconciliationCacheIdentity(value as never), name);
  }
  const selector = selectOwnedAlignmentEvents as (...args: never[]) => unknown;
  for (const [name, args] of [
    ["malformed alignment", [malformedAlignment, 2, 10, 20]],
    ["fractional chunk", [alignment, 1.5, 10, 20]],
    ["reversed window", [alignment, 2, 20, 10]],
  ] as const) assert.throws(() => selector(...(args as unknown as never[])), name);
  assert.throws(() => stableHash({ nested: [1, { value: Number.NaN }] }), "nested nonfinite hash");
  assert.throws(() => stableHash({ nested: { value: Number.POSITIVE_INFINITY } }), "nested infinite hash");
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => stableHash(cyclic), "cyclic hash input");
  assert.throws(() => stableHash(new Date()), "non-plain hash input");
  assert.throws(() => stableHash(1n), "bigint hash input");
  assert.throws(() => assignStableEventId(-1, 0), "negative chunk ID");
  assert.throws(() => assignStableEventId(0, Number.NaN), "nonfinite event ordinal");
  const zero = buildEvidencePacket({ ...base, neighborLimit: 0 });
  assert.deepEqual(zero.context, { contextOnly: true, previousReadableTail: [], nextAlignmentHead: [] });
});
