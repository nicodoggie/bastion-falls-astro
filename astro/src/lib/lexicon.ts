export const getLexicalCategory = (lexicalCategory: string) => {
  switch (lexicalCategory) {
    case "lexinfo:Noun":
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
};