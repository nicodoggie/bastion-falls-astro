import { type LexItem } from "./Lexicon";

export interface LexiconByField {
  id: string;
  title: string;
  fields: Record<string, Field>;
  lexicon: Record<string, LexItem[]>;
}

interface Field {
  label: string;
  uri: string;
}

