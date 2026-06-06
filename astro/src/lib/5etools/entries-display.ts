/**
 * Turn 5etools {@code entries} into display paragraphs. A narrow subset of
 * formatting tags is rendered as sanitized inline HTML; game-data tags remain
 * plain text with 5etools pipe props removed.
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

const sanitizer = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, {
    tagNames: ["em", "strong"],
    attributes: {},
  })
  .use(rehypeStringify);

function stripTagProps(text: string): string {
  return text.split("|")[0]?.trim() ?? "";
}

function render5eTags(input: string): string {
  return input.replace(/\{@(\w+)\s+([^{}]+)\}/g, (_match, rawTag, rawText) => {
    const text = stripTagProps(rawText);
    const formatTag = FORMAT_TAGS[String(rawTag).toLowerCase()];
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
