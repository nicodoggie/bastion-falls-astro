import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";

import { isKnownRuleId } from "./rules/registry.js";
import type { RuleSeveritySetting } from "./rules/types.js";

export const CONFIG_FILENAME = "lex-lint.config.json";

export type MergedLexLintConfig = {
  files: { include: string[]; exclude: string[] };
  rules: Partial<Record<string, RuleSeveritySetting>>;
  shacl: boolean;
  baseIri?: string;
};

const TOP_LEVEL_KEYS = new Set([
  "$schema",
  "files",
  "rules",
  "shacl",
  "baseIri",
]);

const FILES_KEYS = new Set(["include", "exclude"]);

function asRecord(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return v as Record<string, unknown>;
}

function assertStringArray(
  v: unknown,
  field: string,
): string[] {
  if (!Array.isArray(v)) {
    throw new Error(`"${field}" must be an array of strings.`);
  }
  for (const x of v) {
    if (typeof x !== "string") {
      throw new Error(`"${field}" must contain only strings.`);
    }
  }
  return v;
}

function parseRuleSetting(v: unknown, key: string): RuleSeveritySetting {
  if (v === "off" || v === "warn" || v === "error") {
    return v;
  }
  throw new Error(
    `Invalid severity for rule "${key}": expected "off", "warn", or "error".`,
  );
}

export function parseLexLintConfigDocument(raw: string): MergedLexLintConfig {
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const e = errors[0];
    throw new Error(
      e
        ? `Config parse error at offset ${e.offset}: ${e.error}`
        : "Config parse error.",
    );
  }
  if (parsed === undefined) {
    throw new Error("Config is empty or invalid JSONC.");
  }

  const root = asRecord(parsed, "Config root");
  for (const k of Object.keys(root)) {
    if (!TOP_LEVEL_KEYS.has(k)) {
      throw new Error(`Unknown config key: "${k}"`);
    }
  }

  const filesRaw = root["files"];
  let include: string[] = [];
  let exclude: string[] = [];
  if (filesRaw !== undefined) {
    const fr = asRecord(filesRaw, '"files"');
    for (const k of Object.keys(fr)) {
      if (!FILES_KEYS.has(k)) {
        throw new Error(`Unknown "files" key: "${k}"`);
      }
    }
    if (fr["include"] !== undefined) {
      include = assertStringArray(fr["include"], "files.include");
    }
    if (fr["exclude"] !== undefined) {
      exclude = assertStringArray(fr["exclude"], "files.exclude");
    }
  }

  const rulesRaw = root["rules"];
  const rules: Partial<Record<string, RuleSeveritySetting>> = {};
  if (rulesRaw !== undefined) {
    const rr = asRecord(rulesRaw, '"rules"');
    for (const [key, val] of Object.entries(rr)) {
      if (!isKnownRuleId(key)) {
        throw new Error(`Unknown rule id: "${key}"`);
      }
      rules[key] = parseRuleSetting(val, key);
    }
  }

  const shacl = root["shacl"] === true;
  let baseIri: string | undefined;
  if (root["baseIri"] !== undefined && root["baseIri"] !== null) {
    if (typeof root["baseIri"] !== "string") {
      throw new Error('"baseIri" must be a string or null.');
    }
    baseIri = root["baseIri"];
  }

  return {
    files: { include, exclude },
    rules,
    shacl,
    baseIri,
  };
}

export function findLexLintConfigPath(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export function loadLexLintConfigFile(configPath: string): MergedLexLintConfig {
  const raw = readFileSync(configPath, "utf8");
  return parseLexLintConfigDocument(raw);
}

export function defaultLexLintConfig(): MergedLexLintConfig {
  return {
    files: { include: [], exclude: [] },
    rules: {},
    shacl: false,
  };
}

export function mergeConfigWithCli(
  cfg: MergedLexLintConfig,
  cli: { base?: string; shacl?: boolean },
): MergedLexLintConfig {
  return {
    ...cfg,
    baseIri: cli.base ?? cfg.baseIri,
    shacl: cli.shacl ?? cfg.shacl,
  };
}
