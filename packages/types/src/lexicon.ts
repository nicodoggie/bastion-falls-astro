/** Viewer model for lexicon JSON emitted by astro-lexicon-integration. */

export interface LexItem {
  id: string;
  types: string[];
  writtenForm: string;
  phoneticForm: string;
  lexicalCategory: string;
  senses: Sense[];
  protoform?: string;
  note?: string;
  derivedForms?: DerivedForm[];
}

export interface Sense {
  definition: string;
  usage?: string;
  semanticField?: string[];
}

export interface DerivedForm {
  writtenForm: string;
  phoneticForm: string;
  grammaticalMeaning: string;
  decomposition: string;
}

export interface Lexicon {
  id: string;
  title: string;
  lexicon: Record<string, LexItem>;
}

export interface LexiconFieldMeta {
  label: string;
  uri: string;
}

export interface LexiconByField {
  id: string;
  title: string;
  fields: Record<string, LexiconFieldMeta>;
  lexicon: Record<string, LexItem[]>;
}

export interface LexiconSearchSense {
  definition: string;
  usage?: string;
  semanticField?: string[];
}

export interface LexiconSearchEntry {
  id: string;
  types: string[];
  typeLabels: string[];
  writtenForm: string;
  phoneticForm: string;
  senses: LexiconSearchSense[];
  protoform?: string;
  note?: string;
  alphaPage: number;
  fieldUris: string[];
  fieldLabels: string[];
  audio?: LexiconSearchAudio;
}

export interface LexiconSearchIndex {
  version: 1;
  localeId: string;
  title: string;
  entries: LexiconSearchEntry[];
}

export interface LexiconSearchAudioSource {
  url: string;
  type: string;
}

export interface LexiconSearchAudio {
  label?: string;
  sources: LexiconSearchAudioSource[];
}

export function getLexicalCategory(lexicalCategory: string): string {
  switch (lexicalCategory) {
    case "lexinfo:Noun":
    case "lexinfo:CommonNoun":
      return "noun";
    case "lexinfo:Verb":
      return "verb";
    case "lexinfo:Adjective":
      return "adjective";
    case "lexinfo:Adverb":
      return "adverb";
    case "lexinfo:Interjection":
      return "interjection";
    case "lexinfo:Pronoun":
      return "pronoun";
    case "lexinfo:Preposition":
      return "preposition";
    case "lexinfo:Conjunction":
      return "conjunction";
    case "lexinfo:Determiner":
      return "determiner";
    case "lexinfo:Particle":
      return "particle";
    case "lexinfo:Interrogative":
      return "interrogative";
    case "lexinfo:Numeral":
      return "numeral";
    case "lexinfo:Suffix":
      return "suffix";
    default:
      return lexicalCategory;
  }
}

/** Joined POS labels for an entry (lexinfo:* types on the node). */
export function formatLexicalCategories(types: readonly string[]): string {
  return types
    .filter((t) => t.includes("lexinfo:"))
    .map((t) => getLexicalCategory(t))
    .join(", ");
}
