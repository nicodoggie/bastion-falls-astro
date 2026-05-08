/**
 * Turn 5etools {@tag ...} markers into rough plain text for tooltips.
 */
export function strip5eTags(input: string): string {
  return input.replace(/\{@[^}]+\}/g, (m) => {
    const inner = m.slice(2, -1);
    const space = inner.indexOf(" ");
    if (space === -1) return inner;
    let rest = inner.slice(space + 1);
    const pipe = rest.indexOf("|");
    if (pipe !== -1) rest = rest.slice(0, pipe);
    return rest.trim();
  });
}

function stringifyEntryFragment(e: unknown): string {
  if (typeof e === "string") return strip5eTags(e);
  if (e == null || typeof e !== "object") return "";
  const o = e as Record<string, unknown>;
  if (Array.isArray(o.entries)) return entriesToPlain(o.entries as unknown[]);
  if (typeof o.text === "string") return strip5eTags(o.text);
  if (Array.isArray(o.items)) {
    return (o.items as unknown[]).map(stringifyEntryFragment).filter(Boolean).join(" ");
  }
  return "";
}

/** Flatten 5etools `entries` arrays into plain text (tooltip body). */
export function entriesToPlain(entries: unknown[]): string {
  return entries
    .map((e) => stringifyEntryFragment(e))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const SCHOOL_NAMES: Record<string, string> = {
  A: "Abjuration",
  C: "Conjuration",
  D: "Divination",
  E: "Enchantment",
  V: "Evocation",
  I: "Illusion",
  N: "Necromancy",
  T: "Transmutation",
};

export function schoolLabel(code: string | undefined): string {
  if (!code) return "";
  return SCHOOL_NAMES[code] ?? code;
}
