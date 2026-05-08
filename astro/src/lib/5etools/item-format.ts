/** Display helpers for ItemData blobs (plain text, best-effort). */

export function formatItemType(type: unknown): string {
  if (type == null) return "";
  if (typeof type === "string") return type.replace(/([A-Z])/g, " $1").trim();
  if (typeof type === "object" && type !== null) {
    const t = (type as Record<string, unknown>).type;
    if (typeof t === "string") return t;
    if (Array.isArray(t))
      return t.filter((x) => typeof x === "string").join(", ");
  }
  return "";
}

export function formatItemRarity(rarity: unknown): string {
  if (typeof rarity === "string")
    return rarity.charAt(0).toUpperCase() + rarity.slice(1);
  if (rarity == null || typeof rarity !== "object") return "";
  const r = rarity as Record<string, unknown>;
  if (typeof r.name === "string") return r.name;
  if (typeof r.type === "string") return r.type;
  return "";
}

export function formatAttunement(req: unknown): string {
  if (req === true) return "requires attunement";
  if (req === false || req == null) return "";
  if (typeof req === "string") return `requires attunement ${req}`;
  return "";
}
