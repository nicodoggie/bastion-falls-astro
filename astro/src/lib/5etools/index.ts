export {
  loadConditionDisease,
  type ResolvedConditionDisease,
} from "./conditions";
export {
  loadCreatureFromContentJson,
  resolveCreatureFromData,
} from "./creature-data";
export {
  buildResolvedCreature,
  type CreatureJson,
  loadCreature,
  type ResolvedCreature,
} from "./creatures";
export { loadFeat, type ResolvedFeat } from "./feats";
export {
  loadItemFromContentJson,
  resolveItemFromData,
} from "./item-data";
export {
  buildResolvedItem,
  type ItemJson,
  loadItem,
  type ResolvedItem,
} from "./items";
export {
  assert5etoolsDataPresent,
  get5etoolsDataDir,
  getAstroPackageRoot,
  getContentDocsDir,
} from "./paths";
export { loadSense, type ResolvedSense } from "./senses";
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
