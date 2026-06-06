/**
 * Turn 5etools {@code entries} into display paragraphs. A narrow subset of
 * formatting/reference/mechanics tags is rendered as sanitized inline HTML.
 */
import rehypeParse from "rehype-parse";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

const FORMAT_TAGS: Record<string, { open: string; close: string }> = {
  b: { open: "<strong>", close: "</strong>" },
  bold: { open: "<strong>", close: "</strong>" },
  i: { open: "<em>", close: "</em>" },
  italic: { open: "<em>", close: "</em>" },
};

const REFERENCE_TAGS = new Set([
  "condition",
  "creature",
  "feat",
  "item",
  "sense",
  "spell",
]);

const MECHANICS_TAGS = new Set([
  "chance",
  "damage",
  "dc",
  "dice",
  "hit",
  "recharge",
]);

const sanitizer = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, {
    tagNames: ["em", "span", "strong"],
    attributes: {
      span: ["className"],
    },
  })
  .use(rehypeStringify);

function splitTagText(text: string): string[] {
  return text.split("|").map((part) => part.trim());
}

function displayTextFromThirdPipe(text: string): string {
  const parts = splitTagText(text);
  return (parts.length >= 3 ? parts[2] : parts[0]) ?? "";
}

function displayTextFromSecondPipe(text: string): string {
  const parts = splitTagText(text);
  return (parts.length >= 2 ? parts[1] : "") ?? "";
}

function formatMechanicTag(tag: string, text: string): string {
  const displayText = displayTextFromSecondPipe(text);
  const [rawValue = ""] = splitTagText(text);
  switch (tag) {
    case "chance":
      return displayText || `${rawValue} percent`;
    case "dc":
      return displayText || `DC ${rawValue}`;
    case "hit": {
      if (displayText) return displayText;
      const n = Number(rawValue);
      if (Number.isFinite(n)) return `${n >= 0 ? "+" : ""}${n}`;
      return rawValue;
    }
    case "recharge": {
      if (displayText) return displayText;
      const n = Number(rawValue || 6);
      if (!Number.isFinite(n)) return rawValue;
      return `(Recharge ${n}${n < 6 ? "-6" : ""})`;
    }
    case "damage":
    case "dice":
      return displayText || rawValue.replace(/;/g, "/");
    default:
      return displayText;
  }
}

function renderReferenceTag(tag: string, text: string): string {
  return `<span class="bf5e-ref bf5e-ref--inline bf5e-ref--${tag}">${displayTextFromThirdPipe(text)}</span>`;
}

function render5eTags(input: string): string {
  return input.replace(/\{@(\w+)\s+([^{}]+)\}/g, (_match, rawTag, rawText) => {
    const tag = String(rawTag).toLowerCase();
    const formatTag = FORMAT_TAGS[tag];
    if (REFERENCE_TAGS.has(tag)) return renderReferenceTag(tag, rawText);
    if (MECHANICS_TAGS.has(tag)) {
      return `<strong><em>${formatMechanicTag(tag, rawText)}</em></strong>`;
    }
    const text = displayTextFromThirdPipe(rawText);
    if (!formatTag) return text;
    return `${formatTag.open}${text}${formatTag.close}`;
  });
}

function sanitizeInlineHtml(input: string): string {
  return String(sanitizer.processSync(input));
}

function stringifyEntryFragment(e: unknown): string {
  if (typeof e === "string") return render5eTags(e);
  if (e == null || typeof e !== "object") return "";
  const o = e as Record<string, unknown>;

  if (typeof o.name === "string" && Array.isArray(o.entries)) {
    const body = entriesToDisplayParagraphs(o.entries as unknown[]).join(" ");
    const name = render5eTags(o.name);
    return body ? `${name}. ${body}` : name;
  }

  if (Array.isArray(o.entries)) {
    return entriesToDisplayParagraphs(o.entries as unknown[]).join(" ");
  }
  if (typeof o.text === "string") return render5eTags(o.text);
  if (Array.isArray(o.items)) {
    return (o.items as unknown[])
      .map(stringifyEntryFragment)
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

/** One sanitized HTML paragraph per meaningful block; render with `set:html`. */
export function entriesToDisplayParagraphs(
  entries: unknown[] | undefined,
): string[] {
  if (!entries?.length) return [];
  const paragraphs: string[] = [];
  for (const e of entries) {
    const s = sanitizeInlineHtml(
      stringifyEntryFragment(e).replace(/\s+/g, " ").trim(),
    );
    if (s) paragraphs.push(s);
  }
  return paragraphs;
}
