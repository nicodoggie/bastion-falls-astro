import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";

export type CorrectionStatus = "confirmed" | "provisional" | "rejected-as-artifact";

export interface CorrectionRef {
  type?: string;
  path: string;
  role?: string;
  note?: string;
}

export interface CorrectionRule {
  id: string;
  status: CorrectionStatus;
  kind: string;
  canonical?: string | null;
  canonicalRefs?: CorrectionRef[];
  aliases?: string[];
  scope?: {
    campaigns?: string[];
    sessionDates?: string[];
    contexts?: string[];
  };
  apply?: {
    mode?: string;
    safeExactReplacement?: boolean;
  };
  instruction: string;
  evidence?: CorrectionRef[];
}

export interface CorrectionProfile {
  version: number;
  profiles: Record<string, {
    description?: string;
    rules?: CorrectionRule[];
  }>;
}

export function defaultCorrectionsPath(cwd: string): string {
  return join(cwd, "astro", ".bf-transcripts", "corrections.yaml");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Expected a string array");
  }
  return value;
}

function refs(value: unknown): CorrectionRef[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Expected a reference array");
  }
  return value.map((entry) => {
    if (!isObject(entry) || typeof entry["path"] !== "string") {
      throw new Error("Correction references require a path");
    }
    return {
      type: typeof entry["type"] === "string" ? entry["type"] : undefined,
      path: entry["path"],
      role: typeof entry["role"] === "string" ? entry["role"] : undefined,
      note: typeof entry["note"] === "string" ? entry["note"] : undefined,
    };
  });
}

function parseStatus(value: unknown): CorrectionStatus {
  if (value === "confirmed" || value === "provisional" || value === "rejected-as-artifact") {
    return value;
  }
  throw new Error(`Unsupported correction status: ${String(value)}`);
}

function parseRule(value: unknown): CorrectionRule {
  if (!isObject(value)) {
    throw new Error("Correction rule must be an object");
  }
  if (typeof value["id"] !== "string" || !value["id"].trim()) {
    throw new Error("Correction rule requires an id");
  }
  if (typeof value["kind"] !== "string" || !value["kind"].trim()) {
    throw new Error(`Correction rule ${value["id"]} requires a kind`);
  }
  if (typeof value["instruction"] !== "string" || !value["instruction"].trim()) {
    throw new Error(`Correction rule ${value["id"]} requires an instruction`);
  }

  const scope = isObject(value["scope"])
    ? {
        campaigns: strings(value["scope"]["campaigns"]),
        sessionDates: strings(value["scope"]["sessionDates"]),
        contexts: strings(value["scope"]["contexts"]),
      }
    : undefined;
  const apply = isObject(value["apply"])
    ? {
        mode: typeof value["apply"]["mode"] === "string" ? value["apply"]["mode"] : undefined,
        safeExactReplacement: typeof value["apply"]["safeExactReplacement"] === "boolean"
          ? value["apply"]["safeExactReplacement"]
          : undefined,
      }
    : undefined;

  return {
    id: value["id"],
    status: parseStatus(value["status"]),
    kind: value["kind"],
    canonical: typeof value["canonical"] === "string" || value["canonical"] === null ? value["canonical"] : undefined,
    canonicalRefs: refs(value["canonicalRefs"]),
    aliases: strings(value["aliases"]),
    scope,
    apply,
    instruction: value["instruction"],
    evidence: refs(value["evidence"]),
  };
}

export function parseCorrectionProfile(content: string): CorrectionProfile {
  const parsed = yaml.load(content) as unknown;
  if (!isObject(parsed) || parsed["version"] !== 1 || !isObject(parsed["profiles"])) {
    throw new Error("Correction profile must have version: 1 and profiles");
  }

  const profiles: CorrectionProfile["profiles"] = {};
  for (const [name, value] of Object.entries(parsed["profiles"])) {
    if (!isObject(value)) {
      throw new Error(`Correction profile ${name} must be an object`);
    }
    const rawRules = value["rules"];
    if (rawRules !== undefined && !Array.isArray(rawRules)) {
      throw new Error(`Correction profile ${name} rules must be an array`);
    }
    profiles[name] = {
      description: typeof value["description"] === "string" ? value["description"] : undefined,
      rules: rawRules?.map(parseRule),
    };
  }

  return { version: 1, profiles };
}

export function filterCorrectionRules(
  profile: CorrectionProfile,
  options: { campaign: string; sessionDate: string },
): CorrectionRule[] {
  return Object.values(profile.profiles)
    .flatMap((entry) => entry.rules ?? [])
    .filter((rule) => {
      const campaigns = rule.scope?.campaigns;
      if (campaigns && !campaigns.includes(options.campaign)) {
        return false;
      }
      const sessionDates = rule.scope?.sessionDates;
      if (sessionDates && !sessionDates.includes(options.sessionDate)) {
        return false;
      }
      return true;
    });
}

function formatRefs(label: string, refsToFormat: CorrectionRef[] | undefined): string[] {
  if (!refsToFormat?.length) {
    return [];
  }
  return [
    `  - ${label}:`,
    ...refsToFormat.map((ref) => {
      const parts = [
        ref.type ? `${ref.type}` : undefined,
        ref.role ? `role=${ref.role}` : undefined,
        ref.note ? `note=${ref.note}` : undefined,
      ].filter(Boolean);
      return `    - ${ref.path}${parts.length ? ` (${parts.join(", ")})` : ""}`;
    }),
  ];
}

export function renderCorrectionRulesMarkdown(rules: CorrectionRule[]): string {
  if (rules.length === 0) {
    return "";
  }

  return [
    "# Shared Transcription Correction Rules",
    "",
    "Use these human-reviewed rules while correcting transcripts and generating notes.",
    "Apply confirmed rules as authoritative, prefer provisional rules without inventing unsupported facts, and avoid canonizing rejected artifacts.",
    "",
    ...rules.flatMap((rule) => [
      `## ${rule.id}`,
      "",
      `- Status: ${rule.status}`,
      `- Kind: ${rule.kind}`,
      `- Canonical: ${rule.canonical ?? "None"}`,
      `- Aliases: ${rule.aliases?.join(", ") || "None"}`,
      `- Apply mode: ${rule.apply?.mode ?? "prompt-first"}`,
      `- Safe exact replacement: ${rule.apply?.safeExactReplacement === true ? "yes" : "no"}`,
      ...formatRefs("Canonical refs", rule.canonicalRefs),
      `- Instruction: ${rule.instruction.trim()}`,
      ...formatRefs("Evidence", rule.evidence),
      "",
    ]),
  ].join("\n");
}

export async function loadCorrectionRulesMarkdown(options: {
  cwd: string;
  path?: string;
  campaign: string;
  sessionDate: string;
}): Promise<string> {
  const path = options.path ?? defaultCorrectionsPath(options.cwd);
  if (!(await exists(path))) {
    return "";
  }

  const profile = parseCorrectionProfile(await readFile(path, "utf8"));
  return renderCorrectionRulesMarkdown(filterCorrectionRules(profile, {
    campaign: options.campaign,
    sessionDate: options.sessionDate,
  }));
}

export async function writeCorrectionRulesContext(options: {
  outDir: string;
  correctionRules: string;
}): Promise<string> {
  const contextDir = join(options.outDir, "context");
  const path = join(contextDir, "corrections.md");
  await mkdir(contextDir, { recursive: true });
  await writeFile(
    path,
    options.correctionRules.trim()
      ? `${options.correctionRules.trim()}\n`
      : "# Shared Transcription Correction Rules\n\nNone loaded.\n",
    "utf8",
  );
  return path;
}
