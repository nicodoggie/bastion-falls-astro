import type { LexiconSearchEntry } from "@bastion-falls/types";

export type {
  LexiconSearchEntry,
  LexiconSearchAudio,
  LexiconSearchAudioSource,
  LexiconSearchIndex,
  LexiconSearchSense,
} from "@bastion-falls/types";

export type LexiconSearchMatchedField =
  | "word"
  | "phonetic"
  | "definition"
  | "usage"
  | "tag"
  | "type";

export interface LexiconSearchResult {
  entry: LexiconSearchEntry;
  score: number;
  matchedFields: LexiconSearchMatchedField[];
}

export type GlossTokenType = "word" | "prefix" | "suffix" | "clitic";

export interface GlossPairInput {
  source: string;
  gloss: string;
  type?: GlossTokenType;
}

export interface GlossPair {
  id: string;
  source: string;
  gloss: string;
  type: GlossTokenType;
}
