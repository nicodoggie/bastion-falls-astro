export {
  loadConditionDisease,
  type ResolvedConditionDisease,
} from "./conditions";
export { loadFeat, type ResolvedFeat } from "./feats";
export {
  assert5etoolsDataPresent,
  get5etoolsDataDir,
  getAstroPackageRoot,
  getContentDocsDir,
} from "./paths";
export {
  loadSpellFromContentJson,
  resolveSpellFromData,
} from "./spell-data";
export {
  buildResolvedSpell,
  loadSpell,
  type ResolvedSpell,
  type SpellJson,
} from "./spells";

export function truncatePlain(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}
