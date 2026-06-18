import { readFile } from "node:fs/promises";
import path from "node:path";

export interface LexiconPronunciationEntry {
  id: string;
  writtenForm: string;
  phoneticForm: string;
}

export interface PronunciationApproximation {
  symbol: string;
  strategy: string;
  reason: string;
}

export interface EarlyHickMbrolaPlan {
  id: string;
  slug: string;
  writtenForm: string;
  phoneticForm: string;
  pho: string;
  approximations: PronunciationApproximation[];
  unsupported: string[];
}

export interface PostVcGlottalSplit {
  gapMs: number;
  chunks: LexiconPronunciationEntry[];
}

interface PlannedPhone {
  phone: string;
  duration: number;
  kind: "consonant" | "vowel" | "pause";
  approximation?: PronunciationApproximation;
}

const SIMPLE_PHONE_MAP = new Map<string, string>([
  ["a", "A"],
  ["e", "E"],
  ["ɛ", "E"],
  ["i", "I"],
  ["o", "O"],
  ["u", "U"],
  ["p", "P"],
  ["b", "B"],
  ["t", "T"],
  ["d", "D"],
  ["k", "K"],
  ["g", "G"],
  ["f", "F"],
  ["v", "V"],
  ["s", "S"],
  ["z", "Z"],
  ["m", "M"],
  ["n", "N"],
  ["l", "L"],
  ["r", "R"],
  ["j", "J"],
  ["w", "W"],
]);

const VOWELS = new Set(["A", "E", "I", "O", "U"]);

export function slugForLexiconEntry(entry: LexiconPronunciationEntry): string {
  const source = entry.writtenForm || entry.id.replace(/^.*:/, "");
  const slug = source
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['ʔ]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/^-+|-+$/g, "");
  return slug || "entry";
}

export function uniqueSlugsForLexiconEntries(
  entries: readonly LexiconPronunciationEntry[],
): Map<string, string> {
  const seen = new Map<string, number>();
  const slugs = new Map<string, string>();

  for (const entry of entries) {
    const baseSlug = slugForLexiconEntry(entry);
    const count = seen.get(baseSlug) ?? 0;
    seen.set(baseSlug, count + 1);
    slugs.set(entry.id, count === 0 ? baseSlug : `${baseSlug}-${count + 1}`);
  }

  return slugs;
}

export async function loadLexiconEntries(
  shardPaths: readonly string[],
): Promise<LexiconPronunciationEntry[]> {
  const entries: LexiconPronunciationEntry[] = [];

  for (const shardPath of [...shardPaths].sort()) {
    const raw = await readFile(shardPath, "utf8");
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const graph = doc["@graph"];
    if (!Array.isArray(graph)) continue;

    for (const node of graph) {
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const object = node as Record<string, unknown>;
      const types = readTypes(object);
      if (!types.some((type) => type.endsWith("LexicalEntry"))) continue;

      const id = typeof object["@id"] === "string" ? object["@id"] : "";
      const canonicalForm = object["canonicalForm"];
      if (!id || !canonicalForm || typeof canonicalForm !== "object" || Array.isArray(canonicalForm)) {
        continue;
      }

      const form = canonicalForm as Record<string, unknown>;
      const writtenForm = typeof form["writtenRep"] === "string" ? form["writtenRep"] : "";
      const phoneticForm = typeof form["phoneticRep"] === "string" ? form["phoneticRep"] : "";
      if (!writtenForm || !phoneticForm) continue;

      entries.push({ id, writtenForm, phoneticForm });
    }
  }

  entries.sort((a, b) =>
    a.writtenForm.localeCompare(b.writtenForm, "en", {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return entries;
}

export function buildEarlyHickMbrolaPlan(
  entry: LexiconPronunciationEntry,
): EarlyHickMbrolaPlan {
  const approximations: PronunciationApproximation[] = [];
  const unsupported: string[] = [];
  const phones: PlannedPhone[] = [];

  for (const symbol of [...entry.phoneticForm]) {
    if (symbol === "." || symbol === " " || symbol === "-" || symbol === "ˈ" || symbol === "ˌ") {
      continue;
    }

    if (symbol === "θ") {
      const approximation = {
        symbol,
        strategy: "it2:T",
        reason: "MBROLA it2 has no dental fricative; documented default approximates /θ/ with a less-sibilant T.",
      };
      approximations.push(approximation);
      phones.push({ phone: "T", duration: 58, kind: "consonant", approximation });
      continue;
    }

    if (symbol === "ʔ" || symbol === "'") {
      const approximation = {
        symbol: "ʔ",
        strategy: "short_pause",
        reason: "MBROLA it2 has no glottal stop; documented default uses a short silence boundary.",
      };
      approximations.push(approximation);
      phones.push({ phone: "_", duration: 70, kind: "pause", approximation });
      continue;
    }

    if (symbol === "h") {
      const approximation = {
        symbol,
        strategy: "short_boundary",
        reason: "MBROLA it2 has no h phone; documented default uses a short boundary.",
      };
      approximations.push(approximation);
      phones.push({ phone: "_", duration: 25, kind: "pause", approximation });
      continue;
    }

    if (symbol === "ə") {
      const approximation = {
        symbol,
        strategy: "short_low_prominence_A",
        reason: "MBROLA it2 has no schwa; documented default uses shorter, lower-prominence A.",
      };
      approximations.push(approximation);
      phones.push({ phone: "A", duration: 74, kind: "vowel", approximation });
      continue;
    }

    const phone = SIMPLE_PHONE_MAP.get(symbol.toLowerCase());
    if (!phone) {
      if (!unsupported.includes(symbol)) unsupported.push(symbol);
      continue;
    }
    phones.push({
      phone,
      duration: durationForPhone(phone, phones),
      kind: VOWELS.has(phone) ? "vowel" : "consonant",
    });
  }

  const normalizedPhones = finalizePhones(phones);
  return {
    id: entry.id,
    slug: slugForLexiconEntry(entry),
    writtenForm: entry.writtenForm,
    phoneticForm: entry.phoneticForm,
    pho: renderPho(normalizedPhones),
    approximations: dedupeApproximations(approximations),
    unsupported,
  };
}

export function splitEntryForPostVcGlottal(
  entry: LexiconPronunciationEntry,
): PostVcGlottalSplit | undefined {
  if (!/[ʔ']/.test(entry.phoneticForm)) return undefined;

  const phoneticChunks = entry.phoneticForm
    .split(/[ʔ']/)
    .map((value) => value.replace(/^[.\s-]+|[.\s-]+$/g, ""))
    .filter(Boolean);
  const writtenChunks = entry.writtenForm
    .split(/[ʔ']/)
    .map((value) => value.replace(/^[.\s-]+|[.\s-]+$/g, ""))
    .filter(Boolean);

  if (phoneticChunks.length < 2) return undefined;

  const chunks = phoneticChunks.map((phoneticForm, index) => ({
    id: `${entry.id}:glottal-${index + 1}`,
    writtenForm: writtenChunks[index] || phoneticForm.replace(/\./g, ""),
    phoneticForm,
  }));

  return {
    gapMs: 35,
    chunks,
  };
}

export function mbrolaSourcePaths(rootDir: string, slug: string): {
  pho: string;
  wav: string;
} {
  return {
    pho: path.join(rootDir, "mbrola", "pho", `${slug}.pho`),
    wav: path.join(rootDir, "mbrola", "wav", `${slug}.wav`),
  };
}

function readTypes(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string");
  return [];
}

function durationForPhone(phone: string, previous: readonly PlannedPhone[]): number {
  if (phone === "B" && previous.at(-1)?.phone === "R") return 55;
  switch (phone) {
    case "A":
      return previous.some((item) => item.kind === "vowel") ? 82 : 118;
    case "E":
      return 115;
    case "I":
      return 118;
    case "O":
    case "U":
      return 128;
    case "B":
      return 46;
    case "R":
      return 42;
    case "K":
      return 50;
    case "T":
      return 46;
    case "V":
      return 74;
    case "M":
      return 56;
    case "N":
      return 54;
    case "L":
      return 70;
    case "S":
      return 68;
    default:
      return 50;
  }
}

function finalizePhones(phones: readonly PlannedPhone[]): PlannedPhone[] {
  const out = phones.map((phone) => ({ ...phone }));
  const vowelIndexes = out
    .map((phone, index) => (phone.kind === "vowel" ? index : -1))
    .filter((index) => index >= 0);

  if (vowelIndexes.length === 1) {
    const vowel = out[vowelIndexes[0] as number];
    if (vowel) vowel.duration = Math.max(vowel.duration, 150);
  }

  const final = out.at(-1);
  for (let i = 0; i < out.length - 1; i += 1) {
    const phone = out[i];
    const nextPhone = out[i + 1];
    if (phone?.phone === "B" && nextPhone?.phone === "R") {
      phone.duration = 44;
    }
  }

  if (final?.phone === "R") {
    final.duration = 95;
  } else if (final?.phone === "S") {
    final.duration = 145;
  } else if (final?.phone === "L") {
    final.duration = 78;
  }

  return out;
}

function renderPho(phones: readonly PlannedPhone[]): string {
  const lines = ["_ 30"];
  const voicedPhones = phones.filter((phone) => phone.phone !== "_");
  let voicedIndex = 0;

  for (const phone of phones) {
    if (phone.phone === "_") {
      lines.push(`_ ${phone.duration}`);
      continue;
    }
    const index = voicedIndex;
    voicedIndex += 1;
    const isFinal = index === voicedPhones.length - 1;
    lines.push(`${phone.phone} ${phone.duration} ${pitchForPhone(phone, index, isFinal)}`);
  }

  lines.push("_ 170");
  return `${lines.join("\n")}\n`;
}

function pitchForPhone(phone: PlannedPhone, index: number, isFinal: boolean): string {
  const start = index === 0 || (phone.kind === "vowel" && index <= 2) ? 214 : 198;
  const mid = phone.approximation?.symbol === "ə" ? 166 : phone.kind === "vowel" ? 184 : 176;
  const end = isFinal ? 128 : phone.kind === "vowel" ? 176 : 166;
  if (phone.kind === "vowel" || isFinal) return `0 ${start} 35 ${mid} 100 ${end}`;
  return `0 ${start} 100 ${end}`;
}

function dedupeApproximations(
  approximations: readonly PronunciationApproximation[],
): PronunciationApproximation[] {
  const seen = new Set<string>();
  const out: PronunciationApproximation[] = [];
  for (const item of approximations) {
    const key = `${item.symbol}:${item.strategy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
