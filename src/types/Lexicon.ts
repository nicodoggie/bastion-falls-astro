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
