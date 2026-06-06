export {
  loadCreatureFromContentJson,
  resolveCreatureFromData,
} from "./creature-data";
export {
  buildResolvedCreature,
  loadCreature,
  type CreatureJson,
  type ResolvedCreature,
} from "./creatures";
export {
  loadConditionDisease,
  type ResolvedConditionDisease,
} from "./conditions";
export { loadSense, type ResolvedSense } from "./senses";
export { loadFeat, type ResolvedFeat } from "./feats";
export {
  loadItemFromContentJson,
  resolveItemFromData,
} from "./item-data";
export {
  buildResolvedItem,
  loadItem,
  type ItemJson,
  type ResolvedItem,
} from "./items";
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
