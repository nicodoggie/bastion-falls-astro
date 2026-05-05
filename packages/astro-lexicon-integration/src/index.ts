export {
  DuplicateLexicalIdError,
  compileLexiconShard,
  graphObjectToLexItem,
  collectFieldsFromItems,
  flattenByFieldRows,
  fieldLabelToUri,
} from "./compile.js";
export { MANIFEST_VERSION, type LexiconSiteManifest } from "./manifest.js";
export {
  generateLexiconSite,
  type GenerateLexiconSiteOptions,
  type GenerateLexiconSiteResult,
  type AlphaChunk,
  type ByFieldChunk,
  type ByFieldChunkRow,
} from "./generate-site.js";
export {
  computeLexiconInputFingerprint,
  LEXICON_COMPILER_REVISION,
  LEXICON_STAMP_FILENAME,
  type LexiconStampFile,
} from "./fingerprint.js";
export {
  CONTENT_DOCS_PREFIX,
  derivePublicLexiconBase,
  writeStarlightLexiconMdxPages,
  type WriteStarlightLexiconMdxOptions,
  type WriteStarlightLexiconMdxResult,
} from "./starlight-mdx.js";
export { lexiconIntegration, type LexiconIntegrationInput } from "./integration.js";
