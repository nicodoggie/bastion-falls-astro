export const ABILITY_SCORES = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
] as const;

export type AbilityKey = (typeof ABILITY_SCORES)[number]["key"];

interface CharacterSpeed {
  base?: number;
  fly?: number;
  swim?: number;
  burrow?: number;
  special?: string;
}

const SPEED_MODES = [
  { key: "fly", label: "fly" },
  { key: "swim", label: "swim" },
  { key: "burrow", label: "burrow" },
] as const;

export function formatAbilityModifier(score: number): string {
  const modifier = Math.floor((score - 10) / 2);
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

export function formatAbilityScoreDisplay(score: number): {
  modifier: string;
  score: string;
} {
  return {
    modifier: formatAbilityModifier(score),
    score: `${score}`,
  };
}

export function formatSize(size: string): string {
  return `${size.charAt(0).toUpperCase()}${size.slice(1)}`;
}

export function formatSpeed(speed: CharacterSpeed | undefined): string | null {
  if (!speed) return null;

  const parts: string[] = [];
  if (speed.base != null && speed.base > 0) {
    parts.push(`${speed.base} ft.`);
  }

  for (const mode of SPEED_MODES) {
    const value = speed[mode.key];
    if (value != null && value > 0) {
      parts.push(`${mode.label} ${value} ft.`);
    }
  }

  if (speed.special) parts.push(speed.special);

  return parts.length > 0 ? parts.join(", ") : null;
}
