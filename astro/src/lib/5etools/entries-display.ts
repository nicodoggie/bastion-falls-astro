/**
 * Turn 5etools {@code entries} into display paragraphs (plain text after tag
 * stripping). Handles strings, nested `{ entries }`, and `{ name, entries }`
 * blocks.
 */
import { strip5eTags } from "./format-plain.js";

function stringifyEntryFragment(e: unknown): string {
  if (typeof e === "string") return strip5eTags(e);
  if (e == null || typeof e !== "object") return "";
  const o = e as Record<string, unknown>;

  if (typeof o.name === "string" && Array.isArray(o.entries)) {
    const body = entriesToDisplayParagraphs(o.entries as unknown[]).join(" ");
    return body ? `${strip5eTags(o.name)}. ${body}` : strip5eTags(o.name);
  }

  if (Array.isArray(o.entries)) {
    return entriesToDisplayParagraphs(o.entries as unknown[]).join(" ");
  }
  if (typeof o.text === "string") return strip5eTags(o.text);
  if (Array.isArray(o.items)) {
    return (o.items as unknown[])
      .map(stringifyEntryFragment)
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

/** One paragraph per meaningful block; join in template with `<p>`. */
export function entriesToDisplayParagraphs(
  entries: unknown[] | undefined,
): string[] {
  if (!entries?.length) return [];
  const paragraphs: string[] = [];
  for (const e of entries) {
    const s = stringifyEntryFragment(e).replace(/\s+/g, " ").trim();
    if (s) paragraphs.push(s);
  }
  return paragraphs;
}
