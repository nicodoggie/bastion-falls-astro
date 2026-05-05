import type { LexItem, LexiconFieldMeta, Sense } from "@bastion-falls/types";
import { formatLexicalCategories } from "@bastion-falls/types";

export const ONTOLEX_LEXICAL_ENTRY = "http://www.w3.org/ns/lemon/ontolex#LexicalEntry";
export const ONTOLEX_LEXICAL_ENTRY_COMPACT = "ontolex:LexicalEntry";

export class DuplicateLexicalIdError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly id: string,
  ) {
    super(`Duplicate @id "${id}" in ${filePath}`);
    this.name = "DuplicateLexicalIdError";
  }
}

function isLexicalEntryNode(types: string[]): boolean {
  return types.some(
    (t) =>
      t === ONTOLEX_LEXICAL_ENTRY_COMPACT ||
      t === ONTOLEX_LEXICAL_ENTRY ||
      t.endsWith("#LexicalEntry"),
  );
}

function readDefinition(node: Record<string, unknown>): string {
  const def = node.definition;
  if (typeof def === "string") return def;
  if (def && typeof def === "object" && !Array.isArray(def)) {
    const o = def as Record<string, unknown>;
    if (typeof o["@value"] === "string") return o["@value"];
  }
  return "";
}

function normalizeSemanticField(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x : null))
      .filter((x): x is string => x !== null);
  }
  if (typeof raw === "string") return [raw];
  return [];
}

function mapSense(raw: Record<string, unknown>): Sense {
  const usage = typeof raw.usage === "string" ? raw.usage : undefined;
  const fields = normalizeSemanticField(raw["lexinfo:semanticField"]);
  return {
    definition: readDefinition(raw),
    usage,
    semanticField: fields.length ? fields : undefined,
  };
}

function readCanonicalForm(node: Record<string, unknown>): {
  written: string;
  phonetic: string;
} {
  const cf = node.canonicalForm;
  if (!cf || typeof cf !== "object" || Array.isArray(cf)) {
    return { written: "", phonetic: "" };
  }
  const o = cf as Record<string, unknown>;
  const written = typeof o.writtenRep === "string" ? o.writtenRep : "";
  const phonetic = typeof o.phoneticRep === "string" ? o.phoneticRep : "";
  return { written, phonetic };
}

function readEtymology(node: Record<string, unknown>): {
  protoform?: string;
  note?: string;
} {
  const et = node.etymology;
  if (!et || typeof et !== "object" || Array.isArray(et)) return {};
  const o = et as Record<string, unknown>;
  const protoform =
    typeof o["etymon:protoform"] === "string" ? o["etymon:protoform"] : undefined;
  const note =
    typeof o["etymon:note"] === "string" ? o["etymon:note"] : undefined;
  return { protoform, note };
}

function readTypes(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string") as string[];
  return [];
}

function readId(node: Record<string, unknown>): string {
  const id = node["@id"];
  return typeof id === "string" ? id : "";
}

function readSenses(node: Record<string, unknown>): Sense[] {
  const s = node.sense;
  if (!s) return [];
  const arr = Array.isArray(s) ? s : [s];
  return arr
    .filter((x): x is Record<string, unknown> =>
      !!x && typeof x === "object" && !Array.isArray(x),
    )
    .map((x) => mapSense(x))
    .filter(
      (sense) =>
        sense.definition.length > 0 || (sense.semanticField?.length ?? 0) > 0,
    );
}

/**
 * Map one JSON-LD graph object to LexItem if it is a lexical entry.
 */
export function graphObjectToLexItem(node: Record<string, unknown>): LexItem | null {
  const types = readTypes(node);
  if (!isLexicalEntryNode(types)) return null;

  const id = readId(node);
  if (!id) return null;

  const { written, phonetic } = readCanonicalForm(node);
  const senses = readSenses(node);
  const { protoform, note } = readEtymology(node);

  return {
    id,
    types,
    writtenForm: written,
    phoneticForm: phonetic,
    lexicalCategory: formatLexicalCategories(types),
    senses: senses.length ? senses : [{ definition: "" }],
    protoform,
    note,
    derivedForms: undefined,
  };
}

/**
 * Parse @graph from one shard; throws DuplicateLexicalIdError per file.
 */
export function compileLexiconShard(
  filePath: string,
  doc: Record<string, unknown>,
): LexItem[] {
  const graph = doc["@graph"];
  if (!Array.isArray(graph)) {
    throw new Error(`${filePath}: expected @graph array`);
  }

  const seen = new Set<string>();
  const out: LexItem[] = [];

  for (const node of graph) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const o = node as Record<string, unknown>;
    const id = readId(o);
    const item = graphObjectToLexItem(o);
    if (!item) continue;
    if (seen.has(id)) {
      throw new DuplicateLexicalIdError(filePath, id);
    }
    seen.add(id);
    out.push(item);
  }

  return out;
}

export function fieldLabelToUri(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function collectFieldsFromItems(items: readonly LexItem[]): Map<
  string,
  LexiconFieldMeta
> {
  const fields = new Map<string, LexiconFieldMeta>();
  for (const item of items) {
    for (const sense of item.senses ?? []) {
      for (const f of sense.semanticField ?? []) {
        if (!fields.has(f)) {
          fields.set(f, { label: f, uri: fieldLabelToUri(f) });
        }
      }
    }
  }
  return fields;
}

export interface ByFieldFlatRow {
  fieldLabel: string;
  fieldUri: string;
  item: LexItem;
}

/**
 * Flat rows: one row per (entry, semantic field) pair, sorted by field label
 * then written form.
 */
export function flattenByFieldRows(items: readonly LexItem[]): ByFieldFlatRow[] {
  const rows: ByFieldFlatRow[] = [];
  for (const item of items) {
    const fieldSet = new Set<string>();
    for (const sense of item.senses ?? []) {
      for (const f of sense.semanticField ?? []) {
        fieldSet.add(f);
      }
    }
    for (const label of fieldSet) {
      rows.push({
        fieldLabel: label,
        fieldUri: fieldLabelToUri(label),
        item,
      });
    }
  }

  rows.sort((a, b) => {
    const fc = a.fieldLabel.localeCompare(b.fieldLabel, "en", {
      sensitivity: "base",
    });
    if (fc !== 0) return fc;
    return a.item.writtenForm.localeCompare(b.item.writtenForm, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
  return rows;
}
