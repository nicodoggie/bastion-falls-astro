export type ReviewProvider = "hermes" | "off";
export type ReconciliationProvider = "hermes" | "legacy" | "off";
export type LogicalChunks = "single" | "per-stt-chunk" | "three";

export interface ReviewOverrides { provider?: ReviewProvider; hermesProfile?: string; hermesMaxTurns?: number; }
export interface ResolvedReviewSettings { provider: ReviewProvider; hermesProfile?: string; hermesMaxTurns: number; }
export interface ReconciliationOverrides {
  provider?: ReconciliationProvider;
  logicalChunks?: LogicalChunks;
  hermesProfile?: string;
  hermesMaxTurns?: number;
  promptVersion?: string;
  schemaVersion?: string;
}
export interface ResolvedReconciliationSettings {
  provider: ReconciliationProvider;
  logicalChunks: LogicalChunks;
  hermesProfile: string;
  hermesMaxTurns: number;
  promptVersion: string;
  schemaVersion: string;
  source: "default" | "config" | "cli" | "legacy-alias";
}
interface RawConfig { provider?: unknown; logicalChunks?: unknown; hermes?: unknown; promptVersion?: unknown; schemaVersion?: unknown; }
interface RawHermes { profile?: unknown; maxTurns?: unknown; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringField(value: unknown, label: string): string | undefined { if (value === undefined) return undefined; if (typeof value !== "string") throw new Error(`${label} must be a string`); if (value.trim() === "" || value.length > 2_000) throw new Error(`${label} must be a bounded non-empty string`); return value; }
function positiveInt(value: unknown, label: string): number | undefined { if (value === undefined) return undefined; if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 1_000) throw new Error(`${label} must be a bounded positive integer`); return value; }
function knownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void { if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} contains unsupported keys`); }
export function parseReviewProvider(value: string): ReviewProvider { if (value === "hermes" || value === "off") return value; throw new Error(`Unsupported review provider: ${value}`); }
export function parseReconciliationProvider(value: string): ReconciliationProvider { if (value === "hermes" || value === "legacy" || value === "off") return value; throw new Error(`Unsupported reconciliation provider: ${value}`); }
export function parseLogicalChunks(value: string): LogicalChunks { if (value === "single" || value === "per-stt-chunk" || value === "three") return value; throw new Error(`Unsupported reconciliation logicalChunks: ${value}`); }

/** Resolve the deprecated transcribe.review shape without enabling the unified path. */
export function resolveReviewSettings(config: unknown, overrides: ReviewOverrides = {}): ResolvedReviewSettings {
  if (config !== undefined && !isRecord(config)) throw new Error("transcribe.review must be an object");
  const raw = (config ?? {}) as RawConfig;
  const configuredProvider = stringField(raw.provider, "transcribe.review.provider");
  if (raw.hermes !== undefined && !isRecord(raw.hermes)) throw new Error("transcribe.review.hermes must be an object");
  const hermes = (raw.hermes ?? {}) as RawHermes;
  const profile = stringField(hermes.profile, "transcribe.review.hermes.profile");
  const maxTurns = positiveInt(hermes.maxTurns, "transcribe.review.hermes.maxTurns");
  return { provider: overrides.provider ?? (configuredProvider === undefined ? "off" : parseReviewProvider(configuredProvider)), hermesProfile: overrides.hermesProfile ?? profile, hermesMaxTurns: overrides.hermesMaxTurns ?? maxTurns ?? 12 };
}

export function resolveReconciliationSettings(config: unknown, overrides: ReconciliationOverrides = {}, legacyReview?: unknown): ResolvedReconciliationSettings {
  if (config !== undefined && !isRecord(config)) throw new Error("transcribe.reconciliation must be an object");
  const raw = (config ?? {}) as RawConfig;
  knownKeys(raw as unknown as Record<string, unknown>, ["provider", "logicalChunks", "hermes", "promptVersion", "schemaVersion"], "transcribe.reconciliation");
  if (raw.hermes !== undefined && !isRecord(raw.hermes)) throw new Error("transcribe.reconciliation.hermes must be an object");
  const hermes = (raw.hermes ?? {}) as RawHermes;
  knownKeys(hermes as unknown as Record<string, unknown>, ["profile", "maxTurns"], "transcribe.reconciliation.hermes");
  const configuredProvider = stringField(raw.provider, "transcribe.reconciliation.provider");
  const configuredLogical = stringField(raw.logicalChunks, "transcribe.reconciliation.logicalChunks");
  const configProfile = stringField(hermes.profile, "transcribe.reconciliation.hermes.profile");
  const configMaxTurns = positiveInt(hermes.maxTurns, "transcribe.reconciliation.hermes.maxTurns");
  const configPrompt = stringField(raw.promptVersion, "transcribe.reconciliation.promptVersion");
  const configSchema = stringField(raw.schemaVersion, "transcribe.reconciliation.schemaVersion");
  const hasOverrides = Object.values(overrides).some((value) => value !== undefined);
  const hasNew = config !== undefined || hasOverrides;
  let source: ResolvedReconciliationSettings["source"] = hasNew ? (hasOverrides ? "cli" : "config") : "default";
  let provider: ReconciliationProvider = configuredProvider === undefined ? "hermes" : parseReconciliationProvider(configuredProvider);
  if (!hasNew && legacyReview !== undefined) {
    const old = resolveReviewSettings(legacyReview);
    provider = old.provider === "hermes" ? "legacy" : "off";
    source = "legacy-alias";
    return { provider, logicalChunks: "per-stt-chunk", hermesProfile: old.hermesProfile ?? "default", hermesMaxTurns: old.hermesMaxTurns, promptVersion: "legacy.v2", schemaVersion: "legacy.v2", source };
  }
  return { provider: overrides.provider ?? provider, logicalChunks: overrides.logicalChunks ?? (configuredLogical === undefined ? "single" : parseLogicalChunks(configuredLogical)), hermesProfile: overrides.hermesProfile ?? configProfile ?? "default", hermesMaxTurns: overrides.hermesMaxTurns ?? configMaxTurns ?? 12, promptVersion: overrides.promptVersion ?? configPrompt ?? "reconciliation.prompt.v1", schemaVersion: overrides.schemaVersion ?? configSchema ?? "reconciliation.v1", source };
}
