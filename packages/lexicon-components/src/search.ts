import type {
  LexiconSearchEntry,
  LexiconSearchIndex,
  LexiconSearchMatchedField,
  LexiconSearchResult,
} from "./types.ts";

type SearchScope = "smart" | "word" | "def" | "tag" | "type";

interface ParsedQuery {
  scope: SearchScope;
  terms: string[];
}

const PREFIX_RE = /^(word|def|tag|type|pos):(.+)$/i;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function splitTerms(value: string): string[] {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function parseQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  if (!trimmed) return { scope: "smart", terms: [] };
  const prefixed = PREFIX_RE.exec(trimmed);
  if (!prefixed) return { scope: "smart", terms: splitTerms(trimmed) };
  const [, rawScope, rawValue] = prefixed;
  const scope = rawScope.toLowerCase() === "pos" ? "type" : rawScope.toLowerCase();
  return { scope: scope as SearchScope, terms: splitTerms(rawValue ?? "") };
}

function entryText(entry: LexiconSearchEntry, field: LexiconSearchMatchedField): string {
  switch (field) {
    case "word":
      return entry.writtenForm;
    case "phonetic":
      return entry.phoneticForm;
    case "definition":
      return entry.senses.map((sense) => sense.definition).join(" ");
    case "usage":
      return entry.senses.map((sense) => sense.usage ?? "").join(" ");
    case "tag":
      return [...entry.fieldLabels, ...entry.fieldUris].join(" ");
    case "type":
      return [...entry.typeLabels, ...entry.types].join(" ");
  }
}

function fieldMatches(
  entry: LexiconSearchEntry,
  field: LexiconSearchMatchedField,
  terms: readonly string[],
): boolean {
  const haystack = normalize(entryText(entry, field));
  return terms.every((term) => haystack.includes(term));
}

function fieldMatchesAnyTerm(
  entry: LexiconSearchEntry,
  field: LexiconSearchMatchedField,
  terms: readonly string[],
): boolean {
  const haystack = normalize(entryText(entry, field));
  return terms.some((term) => haystack.includes(term));
}

function entryMatchesAcrossFields(
  entry: LexiconSearchEntry,
  fields: readonly LexiconSearchMatchedField[],
  terms: readonly string[],
): boolean {
  const haystack = fields.map((field) => entryText(entry, field)).join(" ");
  const normalized = normalize(haystack);
  return terms.every((term) => normalized.includes(term));
}

function addMatch(
  fields: LexiconSearchMatchedField[],
  field: LexiconSearchMatchedField,
): void {
  if (!fields.includes(field)) fields.push(field);
}

function scoreEntry(
  entry: LexiconSearchEntry,
  parsed: ParsedQuery,
): LexiconSearchResult | null {
  const matchedFields: LexiconSearchMatchedField[] = [];
  let score = 0;
  const terms = parsed.terms;
  if (!terms.length) return null;

  if (parsed.scope === "word") {
    if (!fieldMatches(entry, "word", terms)) return null;
    addMatch(matchedFields, "word");
    score += normalize(entry.writtenForm) === terms.join(" ") ? 100 : 80;
  } else if (parsed.scope === "def") {
    if (!fieldMatches(entry, "definition", terms)) return null;
    addMatch(matchedFields, "definition");
    score += 50;
  } else if (parsed.scope === "tag") {
    if (!fieldMatches(entry, "tag", terms)) return null;
    addMatch(matchedFields, "tag");
    score += 45;
  } else if (parsed.scope === "type") {
    if (!fieldMatches(entry, "type", terms)) return null;
    addMatch(matchedFields, "type");
    score += 45;
  } else {
    const weightedFields: Array<[LexiconSearchMatchedField, number]> = [
      ["word", 90],
      ["phonetic", 70],
      ["definition", 50],
      ["usage", 35],
      ["tag", 30],
      ["type", 25],
    ];
    if (
      !entryMatchesAcrossFields(
        entry,
        weightedFields.map(([field]) => field),
        terms,
      )
    ) {
      return null;
    }
    for (const [field, weight] of weightedFields) {
      if (fieldMatchesAnyTerm(entry, field, terms)) {
        addMatch(matchedFields, field);
        score += weight;
      }
    }
    if (!matchedFields.length) return null;
    if (normalize(entry.writtenForm) === terms.join(" ")) score += 25;
  }

  return { entry, score, matchedFields };
}

export function searchLexicon(
  index: LexiconSearchIndex,
  query: string,
  options: { limit?: number } = {},
): LexiconSearchResult[] {
  const parsed = parseQuery(query);
  if (!parsed.terms.length) return [];
  const results = index.entries
    .map((entry) => scoreEntry(entry, parsed))
    .filter((result): result is LexiconSearchResult => result !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.writtenForm.localeCompare(b.entry.writtenForm, "en", {
        numeric: true,
        sensitivity: "base",
      });
    });
  return typeof options.limit === "number" ? results.slice(0, options.limit) : results;
}

export function listLexiconEntries(
  index: LexiconSearchIndex,
  options: { limit?: number } = {},
): LexiconSearchResult[] {
  const results = [...index.entries]
    .sort((a, b) =>
      a.writtenForm.localeCompare(b.writtenForm, "en", {
        numeric: true,
        sensitivity: "base",
      }),
    )
    .map((entry) => ({
      entry,
      score: 0,
      matchedFields: [],
    }));
  return typeof options.limit === "number" ? results.slice(0, options.limit) : results;
}

export function paginateLexiconResults(
  results: readonly LexiconSearchResult[],
  options: { page: number; pageSize: number },
): {
  items: LexiconSearchResult[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
} {
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(options.page)), pageCount);
  const start = (page - 1) * pageSize;
  return {
    items: results.slice(start, start + pageSize),
    page,
    pageCount,
    pageSize,
    total: results.length,
  };
}

export function summarizeLexiconSenses(
  entry: LexiconSearchEntry,
  limit = 2,
): string[] {
  return entry.senses
    .map((sense) => sense.definition)
    .filter(Boolean)
    .slice(0, Math.max(0, limit));
}

export function listLexiconTypeBadges(entry: LexiconSearchEntry): string[] {
  return [...new Set(entry.typeLabels.map((label) => label.trim()).filter(Boolean))];
}
