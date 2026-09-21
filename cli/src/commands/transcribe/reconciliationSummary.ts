import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { buildCodexExecArgs } from "./codex.js";
import { buildNotesFrontmatter } from "./notes.js";
import type { CanonicalReconciliation } from "./reconciliation.js";
import { stableHash } from "./reconciliationEvidence.js";
import {
  applySummaryCleanupResponse,
  buildSummaryCleanupPrompt,
  classifySummaryRefusal,
  validateSummaryCleanup,
} from "./reconciliationSummaryCleanup.js";
import {
  buildSummaryRepairPrompt,
  classifySummaryRepair,
  normalizeSummaryRepairIssues,
  SUMMARY_REPAIR_VERSION,
  type SummaryLevel,
  type SummaryRepairContext,
} from "./reconciliationSummaryRepair.js";

export const SUMMARY_CONTRACT_VERSION = "summary-contract.v1" as const;

const MAX_RECORDS = 2048;
const MAX_REFS = 128;
const MAX_TIMEOUT_MS = 15 * 60_000;
const MAX_OUTPUT_BYTES = 20_000_000;
const MAX_PROMPT_BYTES = 2_000_000;
const MAX_ROLLING_CONTEXT_CHARS = 4000;
const MIN_RENDERED_NARRATIVE_RATIO = 0.1;
const text = z.string().trim().min(1).max(4000);
const sectionText = z.string().trim().min(1).max(12_000);
const boundedText = z.string().trim().min(1).max(400);
const flag = z.enum([
  "ambiguous-speaker",
  "unclear-words",
  "possible-omission",
  "attribution-uncertain",
  "material-correction",
]);
export const ReviewDispositionSchema = z.enum([
  "carried_as_uncertain",
  "not_material_to_notes",
  "resolved_for_summary",
  "requires_human_review",
]);
const confidence = z.enum(["high", "medium", "low"]);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const uniqueRefs = z
  .array(boundedText)
  .min(1)
  .max(MAX_REFS)
  .superRefine((xs, ctx) => {
    if (new Set(xs).size !== xs.length)
      ctx.addIssue({
        code: "custom",
        message: "duplicate provenance reference",
      });
  });
const derivedRefs = z
  .array(boundedText)
  .min(1)
  .superRefine((xs, ctx) => {
    if (new Set(xs).size !== xs.length)
      ctx.addIssue({
        code: "custom",
        message: "duplicate derived provenance reference",
      });
  });
const flags = z
  .array(flag)
  .max(8)
  .superRefine((xs, ctx) => {
    if (new Set(xs).size !== xs.length)
      ctx.addIssue({ code: "custom", message: "duplicate review flag" });
  });
const ClaimSchema = z
  .object({
    id: boundedText,
    text,
    reconciliationBlockIds: uniqueRefs,
    confidence,
    attribution: boundedText.optional(),
    originalReviewFlags: flags,
  })
  .strict();
const HookSchema = z
  .object({
    id: boundedText,
    text,
    reconciliationBlockIds: uniqueRefs,
    originalReviewFlags: flags,
  })
  .strict();
const DispositionSchema = z
  .object({
    targetId: boundedText,
    disposition: ReviewDispositionSchema,
    originalReviewFlags: flags,
  })
  .strict();
const SourceReviewTargetSchema = z
  .object({
    id: boundedText,
    kind: z.enum(["suspicion-flag", "review-note"]),
    text: boundedText,
    originalReviewFlags: flags,
  })
  .strict();
export const ChunkSummarySchema = z
  .object({
    schemaVersion: z.literal("summary.chunk.v1"),
    cacheIdentity: hash,
    chunkId: boundedText,
    sourceSuspicionFlags: z.array(boundedText).max(MAX_RECORDS),
    reviewNotes: z.array(boundedText).max(MAX_RECORDS),
    sourceReviewTargets: z.array(SourceReviewTargetSchema).max(MAX_RECORDS),
    claims: z.array(ClaimSchema).max(MAX_RECORDS),
    unresolvedHooks: z.array(HookSchema).max(MAX_RECORDS),
    reviewDispositions: z.array(DispositionSchema).max(MAX_RECORDS),
    nextRollingContext: text,
  })
  .strict();
export type ChunkSummary = z.infer<typeof ChunkSummarySchema>;
const SceneClaimSchema = z
  .object({ id: boundedText, text, chunkClaimIds: uniqueRefs })
  .strict();
const SceneHookSchema = z
  .object({ id: boundedText, text, chunkHookIds: uniqueRefs })
  .strict();
export const SceneSummarySchema = z
  .object({
    schemaVersion: z.literal("summary.scene.v1"),
    cacheIdentity: hash,
    sceneId: z.string().regex(/^scene_\d{3}$/u),
    chunkIds: uniqueRefs,
    claims: z.array(SceneClaimSchema).max(MAX_RECORDS),
    unresolvedHooks: z.array(SceneHookSchema).max(MAX_RECORDS),
    chunkClaimProvenance: z
      .record(boundedText, uniqueRefs)
      .superRefine((r, ctx) => {
        if (Object.keys(r).length > MAX_RECORDS)
          ctx.addIssue({
            code: "custom",
            message: "too many provenance records",
          });
      }),
  })
  .strict();
export type SceneSummary = z.infer<typeof SceneSummarySchema>;
const SessionClaimSchema = z
  .object({ id: boundedText, text, sceneClaimIds: uniqueRefs })
  .strict();
const SectionSchema = z
  .object({
    id: boundedText,
    heading: boundedText,
    text: sectionText,
    sceneClaimIds: uniqueRefs,
  })
  .strict();
const SessionHookSchema = z
  .object({ id: boundedText, text, sceneHookIds: uniqueRefs })
  .strict();
export const SessionSummarySchema = z
  .object({
    schemaVersion: z.literal("summary.session.v1"),
    cacheIdentity: hash,
    promptVersion: boundedText,
    claims: z.array(SessionClaimSchema).max(MAX_RECORDS),
    sections: z.array(SectionSchema).max(MAX_RECORDS),
    openHooks: z.array(SessionHookSchema).max(MAX_RECORDS),
    confirmationsNeeded: z.array(boundedText).max(MAX_RECORDS),
    boundaries: z.array(boundedText).max(MAX_RECORDS),
    provenanceMap: z.record(boundedText, derivedRefs).superRefine((r, ctx) => {
      if (Object.keys(r).length > MAX_RECORDS)
        ctx.addIssue({
          code: "custom",
          message: "too many provenance records",
        });
    }),
    campaign: boundedText,
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  })
  .strict();
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
const SessionClaimsProjectionSchema = z
  .object({ claims: z.array(SessionClaimSchema).max(MAX_RECORDS) })
  .passthrough();

const PLAYER_PRIVACY_GUIDANCE =
  "Never expose real player names, usernames, or account identities in generated note prose, attribution, rolling context, hooks, confirmations, and boundaries. Private physical-speaker labels and player-to-character mappings are evidence only, not publishable labels. Use established character names directly. A plausible character attribution with supporting context may be used when its uncertainty is explicit in the reader-facing wording, for example 'probably the ranger' or 'likely Arlen'; do not present a guess as confirmed. When there is insufficient basis even for a qualified guess, use a neutral role or unresolved attribution without naming the player. Uncertainty about character identity is allowed; exposing the player's identity is not. Do not turn a player's family relationship into character canon: resolve whose in-world relative is meant from evidence, or retain the unresolved in-world relationship without the player's name. Preserve game-relevant actions and uncertainty rather than deleting an event merely because its speaker is unclear. Keep required private provenance IDs and caller-owned source-review metadata intact, but do not copy their private identities into reader-facing text.";
const CONTRACTS: Record<SummaryLevel, string> = {
  chunk: JSON.stringify({
    version: SUMMARY_CONTRACT_VERSION,
    level: "chunk",
    schema: "summary.chunk.v1",
    privacyGuidance: PLAYER_PRIVACY_GUIDANCE,
    editorialGuidance:
      "Select current-session game material before creating claims, unresolvedHooks, and nextRollingContext. Exclude performed opening recaps of prior sessions unless current play revisits or advances that material; record only the new development, not the performed recap. Exclude irrelevant real-life conversation, recording checks, and unrelated table banter. Retain out-of-character discussion only when it materially clarifies events, rulings, lore, character intentions, or game decisions; distinguish discussion from in-world events. Keep detailed actions, participants, discoveries, decisions, consequences, and genuine uncertainty. Do not create claims or hooks merely to account for excluded speech. Preserve caller-owned review metadata and emit required source-review dispositions, using not_material_to_notes for excluded material rather than turning it into narrative.",
    unknownKeys: "forbidden",
    forbiddenAliases: ["blockIds", "hooks", "sourceReviewDispositions"],
    ownership: {
      caller: [
        "schemaVersion",
        "cacheIdentity",
        "chunkId",
        "sourceSuspicionFlags",
        "reviewNotes",
        "sourceReviewTargets",
      ],
      model: [
        "claims",
        "unresolvedHooks",
        "reviewDispositions",
        "nextRollingContext",
      ],
    },
    fields: {
      schemaVersion: "literal summary.chunk.v1",
      cacheIdentity: "64 lowercase hex",
      chunkId: "authoritative session_###",
      sourceSuspicionFlags: "string[]",
      reviewNotes: "string[]",
      sourceReviewTargets:
        "{id,kind:suspicion-flag|review-note,text,originalReviewFlags}[]",
      claims:
        "{id,text,reconciliationBlockIds:string[],confidence:high|medium|low,attribution?}[]; originalReviewFlags are derived by code",
      unresolvedHooks:
        "{id,text,reconciliationBlockIds:string[]}[]; originalReviewFlags are derived by code",
      reviewDispositions:
        "{targetId,disposition:carried_as_uncertain|not_material_to_notes|resolved_for_summary|requires_human_review}[]; originalReviewFlags are derived by code",
      nextRollingContext: "string",
    },
    example: {
      schemaVersion: "summary.chunk.v1",
      cacheIdentity:
        "0000000000000000000000000000000000000000000000000000000000000000",
      chunkId: "session_000",
      sourceSuspicionFlags: [],
      reviewNotes: [],
      sourceReviewTargets: [],
      claims: [],
      unresolvedHooks: [],
      reviewDispositions: [],
      nextRollingContext: "No established rolling context.",
    },
  }),
  scene: JSON.stringify({
    version: SUMMARY_CONTRACT_VERSION,
    level: "scene",
    schema: "summary.scene.v1",
    privacyGuidance: PLAYER_PRIVACY_GUIDANCE,
    unknownKeys: "forbidden",
    forbiddenAliases: ["blockIds", "hooks", "sourceReviewDispositions"],
    ownership: {
      caller: [
        "schemaVersion",
        "cacheIdentity",
        "sceneId",
        "chunkIds",
        "chunkClaimProvenance",
      ],
      model: ["claims", "unresolvedHooks"],
    },
    fields: {
      schemaVersion: "literal summary.scene.v1",
      cacheIdentity: "64 lowercase hex",
      sceneId: "authoritative scene_###",
      chunkIds: "nonempty unique authoritative chunk IDs",
      claims: "{id,text,chunkClaimIds:string[]}[]",
      unresolvedHooks: "{id,text,chunkHookIds:string[]}[]",
      chunkClaimProvenance:
        "record claim ID -> reconciliationBlockIds:string[]",
    },
    example: {
      schemaVersion: "summary.scene.v1",
      cacheIdentity:
        "0000000000000000000000000000000000000000000000000000000000000000",
      sceneId: "scene_000",
      chunkIds: ["session_000"],
      claims: [],
      unresolvedHooks: [],
      chunkClaimProvenance: {},
    },
  }),
  session: JSON.stringify({
    version: SUMMARY_CONTRACT_VERSION,
    level: "session",
    schema: "summary.session.v1",
    privacyGuidance: PLAYER_PRIVACY_GUIDANCE,
    editorialGuidance:
      'Use chronological scene headings and Markdown unordered bullets in each sections[].text, not dense paragraphs. Split distinct events into separate bullets, with nested bullets for supporting actions, participants, discoveries, decisions, consequences, and qualifications. Preserve the retained event detail; changing presentation is not permission to compress scenes into generic blurbs. Keep headings in sections[].heading, and encode bullet newlines inside the JSON string without code fences. Example section text: - The party frees the captive.\n  - The captive identifies the tower as the destination.\n- The party decides to investigate the tower. Claims have already been selected for current-session game relevance upstream; do not add performed recaps or unrelated table banter from other context. In rendered note text, use inline self-closing MDX Spell and Item components for confidently identified D&D spells and named items: <Spell name="locate object" src="phb" /> and <Item name="bag of holding" src="dmg" />. Use the established canonical name and source code supported by supplied evidence or repository references; preserve existing supported tags. Leave uncertain identities or source codes as plain text rather than inventing a match, source, or edition. Do not tag class features, mundane actions, or unidentified magical objects as spells or named items. Keep tags inline within the bullets, not inside backticks or code fences; escape attribute quotes correctly in the JSON response. Do not add imports or reproduce compendium descriptions.',
    unknownKeys: "forbidden",
    forbiddenAliases: ["blockIds", "hooks", "sourceReviewDispositions"],
    ownership: {
      caller: [
        "schemaVersion",
        "cacheIdentity",
        "promptVersion",
        "provenanceMap",
        "campaign",
        "sessionDate",
      ],
      model: [
        "claims",
        "sections",
        "openHooks",
        "confirmationsNeeded",
        "boundaries",
      ],
    },
    fields: {
      schemaVersion: "literal summary.session.v1",
      cacheIdentity: "64 lowercase hex",
      promptVersion: "bounded string",
      claims: "{id,text,sceneClaimIds:string[]}[]",
      sections:
        "{id,heading,text:string<=12000 chars,sceneClaimIds:string[]}[]",
      openHooks: "{id,text,sceneHookIds:string[]}[]",
      confirmationsNeeded: "string[]",
      boundaries: "string[]",
      provenanceMap:
        "caller-derived record claim ID -> complete scene/chunk/block IDs; model value is ignored",
      campaign: "caller-supplied string; model value is ignored",
      sessionDate: "caller-supplied YYYY-MM-DD; model value is ignored",
    },
    example: {
      schemaVersion: "summary.session.v1",
      cacheIdentity:
        "0000000000000000000000000000000000000000000000000000000000000000",
      promptVersion: "prompt.v1",
      claims: [],
      sections: [],
      openHooks: [],
      confirmationsNeeded: [],
      boundaries: [],
      provenanceMap: {},
      campaign: "Synthetic Campaign",
      sessionDate: "2026-01-01",
    },
  }),
};
export function contractFor(level: SummaryLevel): string {
  const contract = JSON.parse(CONTRACTS[level]);
  // Show only model-owned output fields; canonical storage retains all metadata.
  for (const field of contract.ownership.caller) {
    delete contract.fields[field];
    delete contract.example[field];
  }
  contract.outputGuidance =
    "Omit caller-owned fields and derived originalReviewFlags. Code supplies them before validation. Campaign and sessionDate may be supplied only when the caller has not supplied them.";
  return JSON.stringify(contract);
}
export function buildChunkContract(): string {
  return contractFor("chunk");
}
export function buildSceneContract(): string {
  return contractFor("scene");
}
export function buildSessionContract(): string {
  return contractFor("session");
}

function ids(values: readonly { id: string }[], label: string): Set<string> {
  const out = new Set<string>();
  for (const x of values) {
    if (out.has(x.id)) throw new Error(`duplicate ${label} id: ${x.id}`);
    out.add(x.id);
  }
  return out;
}
function canonicalBlocks(
  canonical:
    | CanonicalReconciliation
    | {
        chunk: { id: string };
        blocks: readonly { id: string; reviewFlags?: readonly string[] }[];
      },
): readonly { id: string; reviewFlags?: readonly string[] }[] {
  if (!canonical || !Array.isArray(canonical.blocks))
    throw new Error("missing canonical reconciliation blocks");
  return canonical.blocks;
}
function canonicalId(canonical: { chunk: { id: string } }): string {
  if (!/^session_\d{3}$/u.test(canonical.chunk.id))
    throw new Error(`unsafe chunk id: ${canonical.chunk.id}`);
  return canonical.chunk.id;
}
function unionFlags(
  refs: readonly string[],
  blocks: readonly { id: string; reviewFlags?: readonly string[] }[],
): string[] {
  const by = new Map(blocks.map((b) => [b.id, b.reviewFlags ?? []]));
  const out: string[] = [];
  for (const id of refs)
    for (const f of by.get(id) ?? []) if (!out.includes(f)) out.push(f);
  return out;
}
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length &&
    new Set(a).size === a.length &&
    a.every((x) => b.includes(x))
  );
}
function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, index) => x === b[index]);
}
function aggregationId(
  scope: string,
  kind: "claim" | "hook",
  index: number,
): string {
  return `${scope}:${kind}:${String(index).padStart(3, "0")}`;
}
function scopeChunkForScene(chunk: ChunkSummary): ChunkSummary {
  const replacements = new Map<string, string>();
  const claims = chunk.claims.map((claim, index) => {
    const id = aggregationId(chunk.chunkId, "claim", index);
    replacements.set(claim.id, id);
    return { ...claim, id };
  });
  const unresolvedHooks = chunk.unresolvedHooks.map((hook, index) => {
    const id = aggregationId(chunk.chunkId, "hook", index);
    replacements.set(hook.id, id);
    return { ...hook, id };
  });
  return {
    ...chunk,
    claims,
    unresolvedHooks,
    reviewDispositions: chunk.reviewDispositions.map((disposition) => ({
      ...disposition,
      targetId: replacements.get(disposition.targetId) ?? disposition.targetId,
    })),
  };
}
function scopeSceneForSession(scene: SceneSummary): SceneSummary {
  return {
    ...scene,
    claims: scene.claims.map((claim, index) => ({
      ...claim,
      id: aggregationId(scene.sceneId, "claim", index),
    })),
    unresolvedHooks: scene.unresolvedHooks.map((hook, index) => ({
      ...hook,
      id: aggregationId(scene.sceneId, "hook", index),
    })),
  };
}
function reviewTargets(canonical: CanonicalReconciliation): Array<{
  id: string;
  kind: "suspicion-flag" | "review-note";
  text: string;
  originalReviewFlags: string[];
}> {
  const flags = (canonical.suspicionFlags ?? []).map((x, i) => ({
    id: `suspicion:${stableHash(x)}:${i}`,
    kind: "suspicion-flag" as const,
    text: x,
    originalReviewFlags: [] as string[],
  }));
  const notes = (canonical.reviewNotes ?? []).map((x, i) => ({
    id: `review-note:${stableHash(x)}:${i}`,
    kind: "review-note" as const,
    text: x,
    originalReviewFlags: [] as string[],
  }));
  return [...flags, ...notes];
}

type ModelReviewTarget = Omit<
  ReturnType<typeof reviewTargets>[number],
  "id"
> & {
  id: string;
};

function modelReviewTargets(
  canonical: CanonicalReconciliation,
): ModelReviewTarget[] {
  return reviewTargets(canonical).map((target, index) => ({
    ...target,
    id: `review_target_${String(index).padStart(3, "0")}`,
  }));
}

function reviewTargetAliases(
  canonical: CanonicalReconciliation,
): Map<string, string> {
  return new Map(
    modelReviewTargets(canonical).map((target, index) => [
      target.id,
      reviewTargets(canonical)[index]!.id,
    ]),
  );
}

function restoreChunkProvenance(
  value: unknown,
  canonical: CanonicalReconciliation,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return value;
  const inputRecord = value as Record<string, unknown>;
  const context = inputRecord["nextRollingContext"];
  const suffix =
    typeof context === "string" && context.length > MAX_ROLLING_CONTEXT_CHARS
      ? context.slice(-MAX_ROLLING_CONTEXT_CHARS)
      : undefined;
  const sentenceBoundary = suffix?.search(/(?<=[.!?])\s+/u) ?? -1;
  const record =
    suffix === undefined
      ? inputRecord
      : {
          ...inputRecord,
          nextRollingContext:
            sentenceBoundary < 0 ? suffix : suffix.slice(sentenceBoundary + 1),
        };
  const blocks = canonicalBlocks(canonical);
  const restoreItems = (candidate: unknown): unknown =>
    Array.isArray(candidate)
      ? candidate.map((item) => {
          if (typeof item !== "object" || item === null || Array.isArray(item))
            return item;
          const entry = item as Record<string, unknown>;
          if (!Array.isArray(entry["reconciliationBlockIds"])) return item;
          const refs = entry["reconciliationBlockIds"].filter(
            (ref): ref is string => typeof ref === "string",
          );
          return { ...entry, originalReviewFlags: unionFlags(refs, blocks) };
        })
      : candidate;
  const claims = restoreItems(record["claims"]);
  const unresolvedHooks = restoreItems(record["unresolvedHooks"]);
  const flagsByTarget = new Map<string, string[]>();
  for (const candidate of [claims, unresolvedHooks])
    if (Array.isArray(candidate))
      for (const item of candidate) {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          const entry = item as Record<string, unknown>;
          if (
            typeof entry["id"] === "string" &&
            Array.isArray(entry["originalReviewFlags"])
          )
            flagsByTarget.set(
              entry["id"],
              entry["originalReviewFlags"] as string[],
            );
        }
      }
  for (const target of reviewTargets(canonical))
    flagsByTarget.set(target.id, target.originalReviewFlags);
  const aliases = reviewTargetAliases(canonical);
  const reviewDispositions = Array.isArray(record["reviewDispositions"])
    ? record["reviewDispositions"].map((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item))
          return item;
        const entry = item as Record<string, unknown>;
        const targetId =
          typeof entry["targetId"] === "string"
            ? (aliases.get(entry["targetId"]) ?? entry["targetId"])
            : undefined;
        const restored =
          targetId !== undefined ? flagsByTarget.get(targetId) : undefined;
        return restored
          ? { ...entry, targetId, originalReviewFlags: restored }
          : targetId !== undefined && targetId !== entry["targetId"]
            ? { ...entry, targetId }
            : item;
      })
    : record["reviewDispositions"];
  return { ...record, claims, unresolvedHooks, reviewDispositions };
}

export function parseChunkSummary(
  value: unknown,
  canonical:
    | CanonicalReconciliation
    | {
        chunk: { id: string };
        blocks: readonly { id: string; reviewFlags?: readonly string[] }[];
      },
): ChunkSummary {
  const parsed = ChunkSummarySchema.parse(value);
  const blocks = canonicalBlocks(canonical);
  const blockIds = new Set(blocks.map((b) => b.id));
  if (parsed.chunkId !== canonicalId(canonical))
    throw new Error(`chunk ID mismatch: ${parsed.chunkId}`);
  const canonicalFlags =
    (canonical as { suspicionFlags?: readonly string[] }).suspicionFlags ?? [];
  const canonicalNotes =
    (canonical as { reviewNotes?: readonly string[] }).reviewNotes ?? [];
  if (
    !sameSequence(parsed.sourceSuspicionFlags, canonicalFlags) ||
    !sameSequence(parsed.reviewNotes, canonicalNotes)
  )
    throw new Error("source review material mismatch");
  const expectedTargets = reviewTargets(canonical as CanonicalReconciliation);
  if (
    JSON.stringify(parsed.sourceReviewTargets) !==
    JSON.stringify(expectedTargets)
  )
    throw new Error("source review targets mismatch");
  const all = [...parsed.claims, ...parsed.unresolvedHooks];
  ids(all, "claim/hook");
  for (const item of all) {
    for (const ref of item.reconciliationBlockIds)
      if (!blockIds.has(ref))
        throw new Error(`unknown reconciliation block: ${ref}`);
    const expected = unionFlags(item.reconciliationBlockIds, blocks);
    if (!sameSet(item.originalReviewFlags, expected))
      throw new Error(`original review flags mismatch for ${item.id}`);
  }
  const targets = new Map<
    string,
    { id: string; originalReviewFlags: readonly string[] }
  >();
  for (const x of all) targets.set(x.id, x);
  for (const x of parsed.sourceReviewTargets) targets.set(x.id, x);
  const seen = new Set<string>();
  for (const d of parsed.reviewDispositions) {
    if (seen.has(d.targetId))
      throw new Error(`duplicate review disposition target: ${d.targetId}`);
    seen.add(d.targetId);
    const target = targets.get(d.targetId);
    if (!target)
      throw new Error(`unknown review disposition target: ${d.targetId}`);
    if (!sameSet(d.originalReviewFlags, target.originalReviewFlags))
      throw new Error(`disposition flags mismatch for ${d.targetId}`);
  }
  for (const target of targets.values())
    if (!seen.has(target.id))
      throw new Error(`missing durable disposition for ${target.id}`);
  return parsed;
}

export function parseSceneSummary(
  value: unknown,
  chunks: readonly ChunkSummary[],
): SceneSummary {
  const parsed = SceneSummarySchema.parse(value);
  const authoritativeChunks = chunks.map(scopeChunkForScene);
  const chunkBy = new Map(authoritativeChunks.map((c) => [c.chunkId, c]));
  if (
    new Set(parsed.chunkIds).size !== parsed.chunkIds.length ||
    parsed.chunkIds.some((id) => !chunkBy.has(id))
  )
    throw new Error("scene references unknown or duplicate chunk");
  const claims = new Map<string, ChunkSummary["claims"][number]>(),
    hooks = new Map<string, ChunkSummary["unresolvedHooks"][number]>();
  for (const c of authoritativeChunks) {
    for (const x of c.claims) {
      if (claims.has(x.id))
        throw new Error(`duplicate global chunk claim: ${x.id}`);
      claims.set(x.id, x);
    }
    for (const x of c.unresolvedHooks) {
      if (hooks.has(x.id))
        throw new Error(`duplicate global chunk hook: ${x.id}`);
      hooks.set(x.id, x);
    }
  }
  ids(parsed.claims, "scene claim");
  ids(parsed.unresolvedHooks, "scene hook");
  const includedClaims = new Set(
    parsed.chunkIds.flatMap((id) => chunkBy.get(id)!.claims.map((x) => x.id)),
  );
  const includedHooks = new Set(
    parsed.chunkIds.flatMap((id) =>
      chunkBy.get(id)!.unresolvedHooks.map((x) => x.id),
    ),
  );
  const representedClaims = new Set<string>();
  for (const claim of parsed.claims) {
    for (const id of claim.chunkClaimIds) {
      if (!claims.has(id) || !includedClaims.has(id))
        throw new Error("scene claim cites excluded or unknown chunk claim");
      representedClaims.add(id);
    }
  }
  if (!sameSet([...representedClaims], [...includedClaims]))
    throw new Error("scene does not represent every included chunk claim");
  const provenanceKeys = Object.keys(parsed.chunkClaimProvenance);
  if (!sameSet(provenanceKeys, [...includedClaims]))
    throw new Error("scene chunk provenance is incomplete");
  for (const claimId of provenanceKeys) {
    const refs = parsed.chunkClaimProvenance[claimId]!;
    const source = claims.get(claimId)!;
    if (!sameSet(refs, source.reconciliationBlockIds))
      throw new Error(`scene chunk provenance mismatch for ${claimId}`);
  }
  const representedHooks = new Set<string>();
  for (const hook of parsed.unresolvedHooks) {
    if (
      hook.chunkHookIds.some((id) => !hooks.has(id) || !includedHooks.has(id))
    )
      throw new Error("scene hook cites excluded or unknown chunk hook");
    for (const id of hook.chunkHookIds) representedHooks.add(id);
  }
  if (!sameSet([...representedHooks], [...includedHooks]))
    throw new Error("scene does not represent every included chunk hook");
  return parsed;
}

function sessionDomains(scenes: readonly SceneSummary[]): {
  sceneClaims: Map<string, SceneSummary["claims"][number]>;
  sceneHooks: Map<string, SceneSummary["unresolvedHooks"][number]>;
  blockRefs: Map<string, string[]>;
} {
  const sceneClaims = new Map<string, SceneSummary["claims"][number]>(),
    sceneHooks = new Map<string, SceneSummary["unresolvedHooks"][number]>(),
    blockRefs = new Map<string, string[]>();
  for (const scene of scenes) {
    for (const claim of scene.claims) {
      if (sceneClaims.has(claim.id))
        throw new Error(`duplicate global scene claim: ${claim.id}`);
      sceneClaims.set(claim.id, claim);
    }
    for (const hook of scene.unresolvedHooks) {
      if (sceneHooks.has(hook.id))
        throw new Error(`duplicate global scene hook: ${hook.id}`);
      sceneHooks.set(hook.id, hook);
    }
    for (const [claimId, refs] of Object.entries(scene.chunkClaimProvenance))
      blockRefs.set(claimId, refs);
  }
  return { sceneClaims, sceneHooks, blockRefs };
}
function provenanceForSessionClaim(
  claim: SessionSummary["claims"][number],
  domains: ReturnType<typeof sessionDomains>,
): string[] {
  const chain = new Set<string>();
  for (const sceneId of claim.sceneClaimIds) {
    const sceneClaim = domains.sceneClaims.get(sceneId);
    if (!sceneClaim) throw new Error(`unknown scene claim: ${sceneId}`);
    chain.add(sceneClaim.id);
    for (const chunkClaimId of sceneClaim.chunkClaimIds) {
      chain.add(chunkClaimId);
      for (const blockId of domains.blockRefs.get(chunkClaimId) ?? [])
        chain.add(blockId);
    }
  }
  return [...chain];
}
function deriveSessionProvenanceMap(
  claims: readonly SessionSummary["claims"][number][],
  scenes: readonly SceneSummary[],
): Record<string, string[]> {
  const domains = sessionDomains(scenes);
  return Object.fromEntries(
    claims.map((claim) => [
      claim.id,
      provenanceForSessionClaim(claim, domains),
    ]),
  );
}

export function parseSessionSummary(
  value: unknown,
  scenes: readonly SceneSummary[],
): SessionSummary {
  const parsed = SessionSummarySchema.parse(value);
  ids(parsed.claims, "session claim");
  ids(parsed.sections, "section");
  ids(parsed.openHooks, "session hook");
  const domains = sessionDomains(scenes);
  for (const item of [...parsed.claims, ...parsed.sections])
    for (const ref of item.sceneClaimIds)
      if (!domains.sceneClaims.has(ref))
        throw new Error(`unknown scene claim: ${ref}`);
  const renderedClaims = new Set(
    parsed.sections.flatMap((section) => section.sceneClaimIds),
  );
  if (!sameSet([...renderedClaims], [...domains.sceneClaims.keys()]))
    throw new Error("rendered sections omit a scene claim");
  const sourceNarrativeChars = [...domains.sceneClaims.values()].reduce(
    (total, claim) => total + claim.text.length,
    0,
  );
  const renderedNarrativeChars = parsed.sections.reduce(
    (total, section) => total + section.text.length,
    0,
  );
  if (
    sourceNarrativeChars > 0 &&
    renderedNarrativeChars <
      Math.ceil(sourceNarrativeChars * MIN_RENDERED_NARRATIVE_RATIO)
  )
    throw new Error("rendered narrative is pathologically compressed");
  const representedHooks = new Set<string>();
  for (const hook of parsed.openHooks)
    for (const ref of hook.sceneHookIds) {
      if (!domains.sceneHooks.has(ref))
        throw new Error(`unknown scene hook: ${ref}`);
      representedHooks.add(ref);
    }
  if (!sameSet([...representedHooks], [...domains.sceneHooks.keys()]))
    throw new Error("session omits a scene hook");
  const claimIds = new Set(parsed.claims.map((x) => x.id));
  const keys = Object.keys(parsed.provenanceMap);
  if (keys.length !== claimIds.size || keys.some((k) => !claimIds.has(k)))
    throw new Error("provenanceMap keys must equal session claims");
  for (const claim of parsed.claims) {
    const refs = parsed.provenanceMap[claim.id]!;
    if (!sameSet(refs, provenanceForSessionClaim(claim, domains)))
      throw new Error(`incomplete provenance for ${claim.id}`);
  }
  return parsed;
}

export interface PromptOptions {
  canonical:
    | CanonicalReconciliation
    | { chunk: unknown; blocks: readonly unknown[] };
  priorRollingContext?: string;
  campaignContext?: string;
  correctionRules?: readonly string[];
  flaggedAlternatives?: readonly {
    blockId: string;
    alternatives: readonly string[];
  }[];
  promptVersion?: string;
}
const FlaggedAlternativeSchema = z
  .object({
    blockId: boundedText,
    alternatives: z.array(boundedText).max(MAX_REFS),
  })
  .strict();
function boundedOptions(options: PromptOptions): void {
  boundedText.parse(options.promptVersion ?? "unspecified");
  if (options.priorRollingContext !== undefined)
    z.string().max(4000).parse(options.priorRollingContext);
  if (options.campaignContext !== undefined)
    z.string().max(4000).parse(options.campaignContext);
  z.array(text)
    .max(MAX_RECORDS)
    .parse(options.correctionRules ?? []);
  z.array(FlaggedAlternativeSchema)
    .max(MAX_RECORDS)
    .parse(options.flaggedAlternatives ?? []);
}
export function buildChunkSummaryPrompt(options: PromptOptions): string {
  boundedOptions(options);
  const blocks = canonicalBlocks(options.canonical as never);
  const blockIds = new Set(blocks.map((b) => b.id));
  const alternatives = options.flaggedAlternatives ?? [];
  const sourceReviewTargets = modelReviewTargets(
    options.canonical as CanonicalReconciliation,
  );
  for (const x of alternatives) {
    if (!blockIds.has(x.blockId))
      throw new Error(`unknown flagged alternative block: ${x.blockId}`);
  }
  return [
    "Return JSON only.",
    buildChunkContract(),
    `promptVersion: ${options.promptVersion ?? "unspecified"}.`,
    "Cite every claim and hook to supplied reconciliation block IDs; emit one disposition for every claim, hook, and supplied source-review target. Source-review target IDs are invocation-local aliases; code maps them to durable provenance IDs before validation.",
    "<chunk>",
    JSON.stringify((options.canonical as { chunk: unknown }).chunk),
    JSON.stringify(
      blocks.map((block) => ({
        id: block.id,
        start: (block as any).start,
        end: (block as any).end,
        kind: (block as any).kind,
        summarySafeText:
          typeof (block as any).summarySafeText === "string" &&
          (block as any).summarySafeText.trim()
            ? (block as any).summarySafeText
            : "[summary-safe text unavailable; abstract this block without quoting source]",
        channel: (block as any).channel,
        characterCandidate: (block as any).characterCandidate,
        characterConfidence: (block as any).characterConfidence,
        attributionBasis: (block as any).attributionBasis,
        sourceEventIds: (block as any).sourceEventIds,
        reviewFlags: (block as any).reviewFlags,
      })),
    ),
    "</chunk>",
    "<source-review-targets>",
    JSON.stringify(sourceReviewTargets),
    "</source-review-targets>",
    "<prior-rolling-context>",
    options.priorRollingContext?.trim() || "None yet.",
    "</prior-rolling-context>",
    "<campaign-context>",
    options.campaignContext?.trim() || "None.",
    "</campaign-context>",
    "<correction-rules>",
    (options.correctionRules ?? []).join("\n") || "None.",
    "</correction-rules>",
    "<flagged-alternatives>",
    alternatives
      .map((x) => `${x.blockId}: ${x.alternatives.join(" | ")}`)
      .join("\n") || "None.",
    "</flagged-alternatives>",
  ].join("\n");
}
export function buildSceneSummaryPrompt(
  sceneId: string,
  chunks: readonly ChunkSummary[],
): string {
  const modelChunks = chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    claims: chunk.claims.map((claim, index) => ({
      id: `${chunk.chunkId}:claim:${String(index).padStart(3, "0")}`,
      text: claim.text,
      chunkClaimIds: [
        `${chunk.chunkId}:claim:${String(index).padStart(3, "0")}`,
      ],
    })),
    unresolvedHooks: chunk.unresolvedHooks.map((hook, index) => ({
      id: `${chunk.chunkId}:hook:${String(index).padStart(3, "0")}`,
      text: hook.text,
      chunkHookIds: [`${chunk.chunkId}:hook:${String(index).padStart(3, "0")}`],
    })),
  }));
  return [
    "Return JSON only.",
    buildSceneContract(),
    `Use authoritative sceneId ${sceneId}; represent every included chunk claim and hook.`,
    JSON.stringify(modelChunks),
  ].join("\n");
}
export function buildSessionSummaryPrompt(
  promptVersion: string,
  scenes: readonly SceneSummary[],
): string {
  const modelScenes = scenes.map((scene) => ({
    sceneId: scene.sceneId,
    claims: scene.claims,
    unresolvedHooks: scene.unresolvedHooks,
  }));
  return [
    "Return JSON only.",
    buildSessionContract(),
    `promptVersion: ${promptVersion}.`,
    "Write chronological, event-rich session notes. Use readable sections to preserve material actions, participants, discoveries, decisions, and consequences; related details may be grouped, but do not replace distinct scenes with generic thematic blurbs. Represent the game-relevant meaning of every scene claim; multiple claims may be represented by one non-graphic statement with their references retained. Open hooks do not substitute for the narrative. Represent every scene hook, and include each final→scene→chunk→reconciliation-block chain in provenanceMap.",
    "Retain the story with the usual tone and event detail. When needed for safety, related claims may be combined into supported non-graphic event statements while preserving game-relevant meaning and all provenance references; do not let that permission erase ordinary scene detail or alter uncertainty.",
    JSON.stringify(modelScenes),
  ].join("\n");
}

export interface SummaryChunkInput {
  canonical:
    | CanonicalReconciliation
    | {
        chunk: { id: string };
        blocks: readonly { id: string; reviewFlags?: readonly string[] }[];
      };
  priorRollingContext?: string;
  flaggedAlternatives?: readonly {
    blockId: string;
    alternatives: readonly string[];
  }[];
}
const ProviderIdentitySchema = z
  .object({
    provider: boundedText,
    model: boundedText.optional(),
    profile: boundedText.optional(),
  })
  .strict();
export interface ProviderIdentity {
  provider: string;
  model?: string;
  profile?: string;
}
export interface SummarizationOptions {
  outputRoot: string;
  repositoryCwd?: string;
  chunks: readonly (CanonicalReconciliation | SummaryChunkInput)[];
  provider?: string;
  providerIdentity?: ProviderIdentity;
  model?: string;
  promptVersion: string;
  schemaVersion?: string;
  campaignContext?: string;
  correctionRules?: readonly string[];
  infer?: (input: {
    prompt: string;
    canonical: CanonicalReconciliation;
    priorRollingContext: string;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  sceneInfer?: (input: {
    prompt: string;
    chunks: readonly ChunkSummary[];
    signal?: AbortSignal;
  }) => Promise<unknown>;
  sessionInfer?: (input: {
    prompt: string;
    scenes: readonly SceneSummary[];
    signal?: AbortSignal;
  }) => Promise<unknown>;
  campaign?: string;
  sessionDate?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  resume?: boolean;
  force?: boolean;
  sceneGroupSize?: number;
  beforeRename?: () => void | Promise<void>;
  codexCommand?: BoundedCodexCommand | string;
}
function boundedJsonBytes(
  value: unknown,
  maxOutputBytes: number,
  label: string,
): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw operationalError(
      "output-overflow",
      `${label} output could not be serialized`,
    );
  }
  const bytes = Buffer.byteLength(serialized);
  if (bytes > maxOutputBytes)
    throw operationalError("output-overflow", `${label} output exceeds bound`);
  return bytes;
}
function operationalError(
  category:
    | "timeout"
    | "abort"
    | "empty-output"
    | "output-overflow"
    | "identity"
    | "custody"
    | "diagnostic"
    | "atomic-publication"
    | "process",
  message: string,
): Error {
  return Object.assign(new Error(message.slice(0, 400)), {
    repairCategory: category,
  });
}
function inferenceError(error: unknown, label: string): Error {
  const category =
    typeof error === "object" && error !== null && "repairCategory" in error
      ? (error as { repairCategory?: unknown }).repairCategory
      : undefined;
  const operational = [
    "timeout",
    "abort",
    "empty-output",
    "output-overflow",
    "identity",
    "custody",
    "diagnostic",
    "atomic-publication",
    "process",
  ].includes(category as string);
  return Object.assign(
    new Error(
      `${label} inference failed${operational ? ` (${category})` : ""}`,
    ),
    {
      repairCategory: operational ? category : "unknown",
    },
  );
}
async function callInference(
  fn: () => Promise<unknown>,
  label: string,
): Promise<{ value?: unknown; error?: Error }> {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error: inferenceError(error, label) };
  }
}
function semanticValidationError(error: unknown): unknown {
  if (error instanceof Error && !("repairCategory" in error))
    Object.assign(error, { repairCategory: "semantic-validation" });
  return error;
}
async function boundedCall<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  maxOutputBytes: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const task = fn(controller.signal).then(
    (v) => {
      boundedJsonBytes(v, maxOutputBytes, label);
      return v;
    },
    (error) => {
      throw error;
    },
  );
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(operationalError("timeout", `${label} timed out`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
async function atomicJson(
  path: string,
  value: unknown,
  hook?: () => void | Promise<void>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    const h = await open(temp, "wx", 0o600);
    try {
      await h.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await h.sync();
    } finally {
      await h.close();
    }
    await hook?.();
    await rename(temp, path);
    const d = await open(dirname(path), "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } finally {
    await rm(temp, { force: true });
  }
}
export interface BoundedCodexCommandInput {
  prompt: string;
  cwd: string;
  scratch: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  command?: string;
  model?: string;
}
export type BoundedCodexCommand = (
  input: BoundedCodexCommandInput,
) => Promise<unknown>;

function groupExists(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}
function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined || !groupExists(pid)) return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* process-group lookup races are expected during close */
  }
}

export async function runBoundedCodexCommand(
  input: BoundedCodexCommandInput,
): Promise<unknown> {
  const output = join(input.scratch, "response.json");
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > MAX_TIMEOUT_MS
  )
    throw operationalError("process", "invalid Codex timeout");
  if (
    !Number.isInteger(input.maxOutputBytes) ||
    input.maxOutputBytes < 1 ||
    input.maxOutputBytes > MAX_OUTPUT_BYTES
  )
    throw operationalError("process", "invalid Codex output bound");
  if (Buffer.byteLength(input.prompt) > MAX_PROMPT_BYTES)
    throw operationalError("output-overflow", "Codex prompt exceeds bound");
  if (input.cwd.length > 4096 || input.scratch.length > 4096)
    throw operationalError("process", "Codex path exceeds bound");
  const child = spawn(
    input.command ?? "codex",
    buildCodexExecArgs({
      cwd: input.cwd,
      outputPath: output,
      model: input.model,
    }),
    { cwd: input.cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const pid = child.pid;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const cancelTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  let total = 0;
  let overflow = false;
  let settled = false;
  let closed = false;
  let exited = false;
  let ownedGroupAfterExit = false;
  let timedOut = false;
  let aborted = false;
  let childError: Error | undefined;
  let termination: Promise<void> | undefined;
  const terminate = async (): Promise<void> => {
    if (termination) return termination;
    termination = (async () => {
      killGroup(pid, "SIGTERM");
      await new Promise<void>((resolve) => later(100, resolve));
      if ((!exited || ownedGroupAfterExit) && groupExists(pid))
        killGroup(pid, "SIGKILL");
    })();
    return termination;
  };
  const waitForExit = new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      childError = error instanceof Error ? error : new Error(String(error));
      resolve(null);
    });
    child.once("exit", (code) => {
      exited = true;
      ownedGroupAfterExit = groupExists(pid);
      resolve(code);
    });
    const collect = (chunk: Buffer | string) => {
      total += Buffer.byteLength(chunk);
      if (total > input.maxOutputBytes && !overflow) {
        overflow = true;
        void terminate();
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.stdout?.on("error", (error) => {
      childError ??= error instanceof Error ? error : new Error(String(error));
      void terminate();
    });
    child.stderr?.on("error", (error) => {
      childError ??= error instanceof Error ? error : new Error(String(error));
      void terminate();
    });
    child.stdin?.on("error", () => undefined);
    child.once("close", () => {
      closed = true;
    });
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    if (input.signal?.aborted) throw new Error("Codex aborted");
    abortHandler = () => {
      aborted = true;
      void terminate();
    };
    input.signal?.addEventListener("abort", abortHandler, { once: true });
    timeout = later(input.timeoutMs, () => {
      timedOut = true;
      void terminate();
    });
    child.stdin?.end(input.prompt);
    const code = await Promise.race([
      waitForExit,
      new Promise<never>((_, reject) =>
        later(input.timeoutMs + 250, () => {
          void terminate().finally(() =>
            reject(operationalError("timeout", "Codex timed out")),
          );
        }),
      ),
    ]);
    if (overflow)
      throw operationalError("output-overflow", "Codex output exceeds bound");
    if (timedOut) throw operationalError("timeout", "Codex timed out");
    if (aborted) throw operationalError("abort", "Codex aborted");
    if (childError) throw operationalError("process", "Codex process failed");
    if (code !== 0) throw operationalError("process", "Codex process failed");
    const data = await readFile(output);
    if (data.byteLength > input.maxOutputBytes)
      throw operationalError("output-overflow", "Codex response exceeds bound");
    if (data.byteLength === 0)
      throw operationalError("empty-output", "Codex returned empty output");
    // Keep malformed model bytes repairable; validation owns JSON parsing so
    // operational failures above remain non-repairable.
    const raw = data.toString("utf8");
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } finally {
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (abortHandler) input.signal?.removeEventListener("abort", abortHandler);
    if (groupExists(pid)) await terminate();
    cancelTimers();
    await rm(output, { force: true });
    void settled;
    void closed;
  }
}
function inputOf(
  value: CanonicalReconciliation | SummaryChunkInput,
): SummaryChunkInput {
  if (typeof value !== "object" || value === null)
    throw new Error("chunk input must be an object");
  if ("canonical" in value) return value as SummaryChunkInput;
  return { canonical: value as CanonicalReconciliation };
}

function validationDiagnostic(error: unknown): string {
  const issue = normalizeSummaryRepairIssues(error)[0];
  return issue
    ? `${issue.code}: ${issue.message}`.slice(0, 240)
    : "validation failed";
}

async function inferWithOneRepair<T>(args: {
  level: SummaryLevel;
  prompt: string;
  contract: string;
  infer: (prompt: string, input?: unknown) => Promise<unknown>;
  validate: (value: unknown) => T;
  diagnosticsDir: string;
  artifactId: string;
  authoritativeDomains?: readonly string[];
  cleanupInput?: unknown;
  cleanupIdentity?: unknown;
  cleanupPath?: string;
  cleanupResume?: boolean;
  cleanupForce?: boolean;
  retryForCleanedInput?: (value: unknown) => {
    prompt: string;
    input: unknown;
    validate: (value: unknown) => T;
  };
}): Promise<T> {
  if (!/^[a-z]+_[0-9]{3}$|^session$/u.test(args.artifactId))
    throw operationalError("identity", "unsafe summary artifact identity");
  const cleanupPath =
    args.cleanupPath ??
    join(args.diagnosticsDir, `${args.level}-${args.artifactId}-cleanup.json`);
  let durableRetry: { cleaned: unknown; initial: unknown } | undefined;
  let durableInitial: unknown | undefined;
  if (
    args.cleanupInput !== undefined &&
    args.retryForCleanedInput &&
    args.cleanupResume &&
    !args.cleanupForce
  ) {
    try {
      const disk = JSON.parse(await readFile(cleanupPath, "utf8"));
      if (
        disk.cleanupVersion === "summary-cleanup.v1" &&
        disk.cleanupIdentity === stableHash(args.cleanupIdentity) &&
        disk.sourceHash === stableHash(args.cleanupInput) &&
        "initial" in disk
      ) {
        durableInitial = disk.initial;
        if ("cleaned" in disk)
          durableRetry = {
            cleaned: validateSummaryCleanup(args.cleanupInput, disk.cleaned),
            initial: disk.initial,
          };
      }
    } catch {
      /* stale or interrupted cleanup state is ignored */
    }
  }
  const initialResult = durableRetry
    ? { value: durableRetry.initial }
    : durableInitial !== undefined
      ? { value: durableInitial }
      : await callInference(
          () => args.infer(args.prompt, args.cleanupInput),
          `${args.level} summary`,
        );
  if (initialResult.error) throw initialResult.error;
  const initial = initialResult.value;
  if (
    initial === undefined ||
    initial === null ||
    (typeof initial === "string" && initial.trim() === "")
  )
    throw operationalError(
      "empty-output",
      "summary inference returned empty output",
    );
  const validateResponse = (value: unknown, validator = args.validate): T =>
    validator(typeof value === "string" ? JSON.parse(value) : value);
  try {
    return validateResponse(initial);
  } catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof SyntaxError))
      semanticValidationError(error);
    if (
      args.cleanupInput !== undefined &&
      args.retryForCleanedInput &&
      classifySummaryRefusal(initial).eligible
    ) {
      try {
        if (!durableRetry && durableInitial === undefined)
          await atomicJson(cleanupPath, {
            cleanupIdentity: stableHash(args.cleanupIdentity),
            sourceHash: stableHash(args.cleanupInput),
            cleanupVersion: "summary-cleanup.v1",
            initial,
          });
        let cleaned: unknown;
        if (durableRetry) cleaned = durableRetry.cleaned;
        try {
          if (cleaned === undefined) {
            const disk = JSON.parse(await readFile(cleanupPath, "utf8"));
            if (
              disk.cleanupVersion === "summary-cleanup.v1" &&
              disk.cleanupIdentity === stableHash(args.cleanupIdentity) &&
              disk.sourceHash === stableHash(args.cleanupInput)
            )
              cleaned = validateSummaryCleanup(args.cleanupInput, disk.cleaned);
          }
        } catch {
          /* interrupted or stale cleanup is regenerated */
        }
        if (cleaned === undefined) {
          const cleanupPrompt = buildSummaryCleanupPrompt(
            args.level,
            args.cleanupInput,
          );
          const cleanupResult = await callInference(
            () => args.infer(cleanupPrompt),
            `${args.level} summary cleanup`,
          );
          if (cleanupResult.error) throw cleanupResult.error;
          await atomicJson(
            join(
              args.diagnosticsDir,
              `${args.level}-${args.artifactId}-cleanup-response.json`,
            ),
            cleanupResult.value,
          );
          const candidate =
            typeof cleanupResult.value === "string"
              ? JSON.parse(cleanupResult.value)
              : cleanupResult.value;
          cleaned = applySummaryCleanupResponse(args.cleanupInput, candidate);
          await atomicJson(cleanupPath, {
            cleanupIdentity: stableHash(args.cleanupIdentity),
            sourceHash: stableHash(args.cleanupInput),
            cleanupVersion: "summary-cleanup.v1",
            initial,
            cleaned,
          });
        }
        const retry = args.retryForCleanedInput(cleaned);
        const retryResult = await callInference(
          () => args.infer(retry.prompt, retry.input),
          `${args.level} summary after refusal cleanup`,
        );
        if (retryResult.error) throw retryResult.error;
        await atomicJson(
          join(
            args.diagnosticsDir,
            `${args.level}-${args.artifactId}-refusal-cleanup.json`,
          ),
          { level: args.level, cleanupPath, result: retryResult.value },
        );
        try {
          return validateResponse(retryResult.value, retry.validate);
        } catch (error) {
          throw new Error(
            `${args.level} summary invalid after refusal cleanup: ${validationDiagnostic(error)}`,
          );
        }
      } catch (failure) {
        const category =
          failure instanceof Error && "repairCategory" in failure
            ? failure.repairCategory
            : "semantic-validation";
        throw Object.assign(
          new Error(
            `${args.level} refusal recovery failed; diagnostics: ${cleanupPath}; ${args.diagnosticsDir}; ${validationDiagnostic(failure)}`,
          ),
          { repairCategory: category },
        );
      }
    }
    const decision = classifySummaryRepair(error);
    if (decision.eligible !== true) throw error;
    await atomicJson(
      join(
        args.diagnosticsDir,
        `${args.level}-${args.artifactId}-initial.json`,
      ),
      initial,
    );
    const issues = normalizeSummaryRepairIssues(error);
    const repairPrompt = buildSummaryRepairPrompt({
      level: args.level,
      originalResponse: initial,
      issues,
      contract: args.contract,
      authoritativeDomains: args.authoritativeDomains,
    });
    const repairResult = await callInference(
      () => args.infer(repairPrompt),
      `${args.level} summary repair`,
    );
    if (repairResult.error) throw repairResult.error;
    const repair = repairResult.value;
    await atomicJson(
      join(args.diagnosticsDir, `${args.level}-${args.artifactId}-repair.json`),
      repair,
    );
    try {
      return validateResponse(repair);
    } catch (error) {
      throw new Error(
        `${args.level} summary invalid after one repair: ${validationDiagnostic(error)}`,
      );
    }
  }
}

function validateRunOptions(options: SummarizationOptions): void {
  if (
    !Array.isArray(options.chunks) ||
    !options.chunks.length ||
    options.chunks.length > MAX_RECORDS
  )
    throw new Error("chunks must be nonempty and bounded");
  for (const raw of options.chunks) {
    const canonical = inputOf(raw).canonical;
    canonicalId(canonical as { chunk: { id: string } });
    if (!canonicalBlocks(canonical as never).length)
      throw new Error("chunks must contain nonempty canonical blocks");
  }
  boundedText.parse(options.promptVersion);
  if (options.provider !== undefined) boundedText.parse(options.provider);
  if (options.schemaVersion !== undefined)
    boundedText.parse(options.schemaVersion);
  if (options.campaign !== undefined) boundedText.parse(options.campaign);
  if (options.sessionDate !== undefined)
    z.string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .parse(options.sessionDate);
  if (options.campaignContext !== undefined)
    z.string().max(4000).parse(options.campaignContext);
  z.array(text)
    .max(MAX_RECORDS)
    .parse(options.correctionRules ?? []);
  z.array(FlaggedAlternativeSchema)
    .max(MAX_RECORDS)
    .parse(
      options.chunks.flatMap((raw) => inputOf(raw).flaggedAlternatives ?? []),
    );
  if (options.providerIdentity)
    ProviderIdentitySchema.parse(options.providerIdentity);
  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > MAX_TIMEOUT_MS)
  )
    throw new Error("invalid timeoutMs");
  if (
    options.maxOutputBytes !== undefined &&
    (!Number.isInteger(options.maxOutputBytes) ||
      options.maxOutputBytes < 1 ||
      options.maxOutputBytes > MAX_OUTPUT_BYTES)
  )
    throw new Error("invalid maxOutputBytes");
  if (
    options.sceneGroupSize !== undefined &&
    (!Number.isInteger(options.sceneGroupSize) ||
      options.sceneGroupSize < 1 ||
      options.sceneGroupSize > MAX_RECORDS)
  )
    throw new Error("invalid sceneGroupSize");
}
export async function runReconciliationSummarization(
  options: SummarizationOptions,
): Promise<{
  chunks: ChunkSummary[];
  scenes: SceneSummary[];
  session: SessionSummary;
}> {
  validateRunOptions(options);
  const timeoutMs = options.timeoutMs ?? 120_000,
    maxOutputBytes = options.maxOutputBytes ?? 2_000_000,
    groupSize = options.sceneGroupSize ?? 5;
  const root = join(options.outputRoot, "summarization"),
    chunkDir = join(root, "chunks"),
    sceneDir = join(root, "scenes"),
    diagnosticsDir = join(root, "diagnostics");
  await mkdir(chunkDir, { recursive: true });
  await mkdir(sceneDir, { recursive: true });
  const providerIdentity = options.providerIdentity ?? {
    provider: options.provider ?? "codex",
    model: "codex",
    profile: "default",
  };
  const chunks: ChunkSummary[] = [];
  let prior = "";
  const scratch = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(join(tmpdir(), "bf-summary-")),
  );
  const infer = async (prompt: string, cwd: string, signal?: AbortSignal) =>
    typeof options.codexCommand === "function"
      ? options.codexCommand({
          prompt,
          cwd,
          scratch,
          timeoutMs,
          maxOutputBytes,
          signal,
          model: options.model,
        })
      : runBoundedCodexCommand({
          prompt,
          cwd,
          scratch,
          timeoutMs,
          maxOutputBytes,
          signal,
          command: options.codexCommand,
          model: options.model,
        });
  try {
    for (const raw of options.chunks) {
      const input = inputOf(raw);
      const canonical = input.canonical as CanonicalReconciliation;
      const id = canonicalId(canonical);
      const prompt = buildChunkSummaryPrompt({
        canonical,
        priorRollingContext: prior,
        campaignContext: options.campaignContext,
        correctionRules: options.correctionRules,
        flaggedAlternatives: input.flaggedAlternatives,
        promptVersion: options.promptVersion,
      });
      const identity = {
        type: "chunk",
        contract: SUMMARY_CONTRACT_VERSION,
        repair: SUMMARY_REPAIR_VERSION,
        inputHash: stableHash(canonical),
        priorRollingContext: stableHash(prior),
        campaignContext: stableHash(options.campaignContext ?? ""),
        correctionRules: stableHash(options.correctionRules ?? []),
        flaggedAlternatives: stableHash(input.flaggedAlternatives ?? []),
        campaign: options.campaign ?? "",
        sessionDate: options.sessionDate ?? "",
        promptVersion: options.promptVersion,
        prompt: stableHash(prompt),
        schema: options.schemaVersion ?? "summary.v1",
        providerIdentity: stableHash(providerIdentity),
        model: options.model ?? "codex",
      };
      const cacheIdentity = stableHash(identity);
      const path = join(chunkDir, `${id}.json`);
      let parsed: ChunkSummary | undefined;
      if (!options.force && options.resume !== false) {
        try {
          const disk = JSON.parse(await readFile(path, "utf8"));
          if (disk.cacheIdentity === cacheIdentity)
            parsed = parseChunkSummary(disk, canonical);
        } catch {
          /* stale/corrupt is repaired */
        }
      }
      if (!parsed) {
        parsed = await inferWithOneRepair({
          level: "chunk",
          prompt,
          contract: buildChunkContract(),
          authoritativeDomains: [
            ...canonicalBlocks(canonical).map((block) => block.id),
            ...modelReviewTargets(canonical).map((target) => target.id),
          ],
          infer: async (request, retryInput) =>
            options.infer
              ? await boundedCall(
                  (signal) =>
                    options.infer!({
                      prompt: request,
                      canonical: (retryInput ??
                        canonical) as CanonicalReconciliation,
                      priorRollingContext: prior,
                      signal,
                    }),
                  timeoutMs,
                  maxOutputBytes,
                  "chunk inference",
                )
              : infer(request, options.repositoryCwd ?? process.cwd()),
          diagnosticsDir,
          artifactId: id,
          cleanupInput: canonical,
          cleanupIdentity: {
            type: "chunk-cleanup",
            cleanupVersion: "summary-cleanup.v1",
            providerIdentity,
            promptVersion: options.promptVersion,
            prompt: stableHash(prompt),
            source: stableHash(canonical),
          },
          cleanupResume: options.resume !== false,
          cleanupForce: options.force === true,
          retryForCleanedInput: (cleaned) => {
            const safeCanonical = cleaned as CanonicalReconciliation;
            return {
              prompt: buildChunkSummaryPrompt({
                canonical: safeCanonical,
                priorRollingContext: prior,
                campaignContext: options.campaignContext,
                correctionRules: options.correctionRules,
                flaggedAlternatives: input.flaggedAlternatives,
                promptVersion: options.promptVersion,
              }),
              input: safeCanonical,
              validate: (value: unknown) =>
                parseChunkSummary(
                  {
                    ...(restoreChunkProvenance(value, canonical) as object),
                    schemaVersion: "summary.chunk.v1",
                    cacheIdentity,
                    chunkId: id,
                    sourceSuspicionFlags: canonical.suspicionFlags,
                    reviewNotes: canonical.reviewNotes,
                    sourceReviewTargets: reviewTargets(canonical),
                  },
                  canonical,
                ),
            };
          },
          validate: (value) =>
            parseChunkSummary(
              {
                ...(restoreChunkProvenance(value, canonical) as object),
                schemaVersion: "summary.chunk.v1",
                cacheIdentity,
                chunkId: id,
                sourceSuspicionFlags: canonical.suspicionFlags,
                reviewNotes: canonical.reviewNotes,
                sourceReviewTargets: reviewTargets(canonical),
              },
              canonical,
            ),
        });
        await atomicJson(path, parsed, options.beforeRename);
      }
      chunks.push(parsed);
      prior = parsed.nextRollingContext;
    }
    const scenes: SceneSummary[] = [];
    for (let i = 0; i < chunks.length; i += groupSize) {
      const group = chunks.slice(i, i + groupSize).map(scopeChunkForScene),
        sceneId = `scene_${String(i / groupSize).padStart(3, "0")}`;
      const prompt = buildSceneSummaryPrompt(sceneId, group);
      const identity = {
        type: "scene",
        contract: SUMMARY_CONTRACT_VERSION,
        repair: SUMMARY_REPAIR_VERSION,
        sceneId,
        group: stableHash(group),
        prompt: stableHash(prompt),
        providerIdentity: stableHash(providerIdentity),
        model: options.model ?? "codex",
        promptVersion: options.promptVersion,
        campaign: options.campaign ?? "",
        sessionDate: options.sessionDate ?? "",
      };
      const cacheIdentity = stableHash(identity),
        path = join(sceneDir, `${sceneId}.json`);
      let scene: SceneSummary | undefined;
      if (!options.force && options.resume !== false) {
        try {
          const disk = JSON.parse(await readFile(path, "utf8"));
          if (
            disk.cacheIdentity === cacheIdentity &&
            disk.sceneId === sceneId &&
            Array.isArray(disk.chunkIds) &&
            sameSequence(
              disk.chunkIds,
              group.map((chunk) => chunk.chunkId),
            )
          )
            scene = scopeSceneForSession(parseSceneSummary(disk, group));
        } catch {
          /* repair */
        }
      }
      if (!scene) {
        scene = scopeSceneForSession(
          await inferWithOneRepair({
            level: "scene",
            prompt,
            contract: buildSceneContract(),
            authoritativeDomains: [
              ...group.map((chunk) => chunk.chunkId),
              ...group.flatMap((chunk) =>
                [...chunk.claims, ...chunk.unresolvedHooks].map(
                  (item) => item.id,
                ),
              ),
            ],
            infer: async (request, retryInput) =>
              options.sceneInfer
                ? await boundedCall(
                    (signal) =>
                      options.sceneInfer!({
                        prompt: request,
                        chunks: (retryInput ??
                          group) as readonly ChunkSummary[],
                        signal,
                      }),
                    timeoutMs,
                    maxOutputBytes,
                    "scene inference",
                  )
                : infer(request, options.repositoryCwd ?? process.cwd()),
            diagnosticsDir,
            artifactId: sceneId,
            cleanupInput: group,
            cleanupIdentity: {
              type: "scene-cleanup",
              cleanupVersion: "summary-cleanup.v1",
              providerIdentity,
              promptVersion: options.promptVersion,
              sceneId,
              prompt: stableHash(prompt),
              source: stableHash(group),
            },
            cleanupResume: options.resume !== false,
            cleanupForce: options.force === true,
            retryForCleanedInput: (cleaned) => {
              const safeGroup = cleaned as ChunkSummary[];
              return {
                prompt: buildSceneSummaryPrompt(sceneId, safeGroup),
                input: safeGroup,
                validate: (value: unknown) =>
                  parseSceneSummary(
                    {
                      ...(value as object),
                      schemaVersion: "summary.scene.v1",
                      cacheIdentity,
                      sceneId,
                      chunkIds: group.map((chunk) => chunk.chunkId),
                      chunkClaimProvenance: Object.fromEntries(
                        group.flatMap((c) =>
                          c.claims.map((claim) => [
                            claim.id,
                            claim.reconciliationBlockIds,
                          ]),
                        ),
                      ),
                    },
                    group,
                  ),
              };
            },
            validate: (value) =>
              parseSceneSummary(
                {
                  ...(value as object),
                  schemaVersion: "summary.scene.v1",
                  cacheIdentity,
                  sceneId,
                  chunkIds: group.map((chunk) => chunk.chunkId),
                  chunkClaimProvenance: Object.fromEntries(
                    group.flatMap((c) =>
                      c.claims.map((claim) => [
                        claim.id,
                        claim.reconciliationBlockIds,
                      ]),
                    ),
                  ),
                },
                group,
              ),
          }),
        );
        await atomicJson(path, scene, options.beforeRename);
      }
      scenes.push(scene);
    }
    const sessionPrompt = buildSessionSummaryPrompt(
      options.promptVersion,
      scenes,
    );
    const sessionIdentity = {
      type: "session",
      contract: SUMMARY_CONTRACT_VERSION,
      repair: SUMMARY_REPAIR_VERSION,
      scenes: stableHash(scenes),
      prompt: stableHash(sessionPrompt),
      providerIdentity: stableHash(providerIdentity),
      model: options.model ?? "codex",
      promptVersion: options.promptVersion,
      campaign: options.campaign ?? "",
      sessionDate: options.sessionDate ?? "",
    };
    const sessionCacheIdentity = stableHash(sessionIdentity),
      sessionPath = join(root, "session.json");
    let session: SessionSummary | undefined;
    if (!options.force && options.resume !== false) {
      try {
        const disk = JSON.parse(await readFile(sessionPath, "utf8"));
        if (
          disk.cacheIdentity === sessionCacheIdentity &&
          disk.promptVersion === options.promptVersion
        ) {
          const candidate = parseSessionSummary(disk, scenes);
          if (
            (options.campaign === undefined ||
              candidate.campaign === options.campaign) &&
            (options.sessionDate === undefined ||
              candidate.sessionDate === options.sessionDate)
          )
            session = candidate;
        }
      } catch {
        /* repair */
      }
    }
    if (!session) {
      session = await inferWithOneRepair({
        level: "session",
        prompt: sessionPrompt,
        contract: buildSessionContract(),
        authoritativeDomains: [
          ...scenes.flatMap((scene) =>
            [...scene.claims, ...scene.unresolvedHooks].map((item) => item.id),
          ),
        ],
        infer: async (request, retryInput) =>
          options.sessionInfer
            ? await boundedCall(
                (signal) =>
                  options.sessionInfer!({
                    prompt: request,
                    scenes: (retryInput ?? scenes) as readonly SceneSummary[],
                    signal,
                  }),
                timeoutMs,
                maxOutputBytes,
                "session inference",
              )
            : infer(request, options.repositoryCwd ?? process.cwd()),
        diagnosticsDir,
        artifactId: "session",
        cleanupInput: scenes,
        cleanupIdentity: {
          type: "session-cleanup",
          cleanupVersion: "summary-cleanup.v1",
          providerIdentity,
          promptVersion: options.promptVersion,
          prompt: stableHash(sessionPrompt),
          source: stableHash(scenes),
        },
        cleanupResume: options.resume !== false,
        cleanupForce: options.force === true,
        retryForCleanedInput: (cleaned) => {
          const safeScenes = cleaned as SceneSummary[];
          const safePrompt = buildSessionSummaryPrompt(
            options.promptVersion,
            safeScenes,
          );
          return {
            prompt: safePrompt,
            input: safeScenes,
            validate: (value: unknown) => {
              const claims = SessionClaimsProjectionSchema.parse(value).claims;
              return parseSessionSummary(
                {
                  ...(value as object),
                  schemaVersion: "summary.session.v1",
                  cacheIdentity: sessionCacheIdentity,
                  promptVersion: options.promptVersion,
                  provenanceMap: deriveSessionProvenanceMap(claims, scenes),
                  ...(options.campaign === undefined
                    ? {}
                    : { campaign: options.campaign }),
                  ...(options.sessionDate === undefined
                    ? {}
                    : { sessionDate: options.sessionDate }),
                },
                scenes,
              );
            },
          };
        },
        validate: (value) => {
          const claims = SessionClaimsProjectionSchema.parse(value).claims;
          return parseSessionSummary(
            {
              ...(value as object),
              schemaVersion: "summary.session.v1",
              cacheIdentity: sessionCacheIdentity,
              promptVersion: options.promptVersion,
              provenanceMap: deriveSessionProvenanceMap(claims, scenes),
              ...(options.campaign === undefined
                ? {}
                : { campaign: options.campaign }),
              ...(options.sessionDate === undefined
                ? {}
                : { sessionDate: options.sessionDate }),
            },
            scenes,
          );
        },
      });
      await atomicJson(sessionPath, session, options.beforeRename);
    }
    return { chunks, scenes, session };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function renderSessionMdx(
  value: unknown,
  authoritativeScenes: readonly SceneSummary[],
): string {
  const session = parseSessionSummary(value, authoritativeScenes);
  const body = session.sections
    .map((s) => `## ${s.heading}\n\n${s.text}`)
    .join("\n\n");
  const optional = (
    [
      ["Open Hooks", session.openHooks.map((x) => x.text)],
      ["Confirmations Needed", session.confirmationsNeeded],
      ["Boundaries", session.boundaries],
    ] as const
  )
    .filter(([, xs]) => xs.length)
    .map(
      ([heading, xs]) =>
        `## ${heading}\n\n${xs.map((x) => `- ${x}`).join("\n")}`,
    )
    .join("\n\n");
  return `${buildNotesFrontmatter({ campaign: session.campaign, sessionDate: session.sessionDate })}${body}${optional ? `\n\n${optional}` : ""}\n`;
}
export { atomicJson };
