export { assert5etoolsDataPresent, get5etoolsDataDir, getContentDocsDir, getAstroPackageRoot } from "./paths";
export { loadSpell, type ResolvedSpell, type SpellJson, buildResolvedSpell } from "./spells";
export {
  loadSpellFromContentJson,
  resolveSpellFromData,
} from "./spell-data";
export { loadFeat, type ResolvedFeat } from "./feats";
export {
  loadConditionDisease,
  type ResolvedConditionDisease,
} from "./conditions";

export function truncatePlain(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}
