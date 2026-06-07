/**
 * Turn 5etools {@code entries} into display paragraphs. A narrow subset of
 * formatting/reference/mechanics tags is rendered as sanitized inline HTML.
 */
import { randomUUID } from "node:crypto";

import rehypeParse from "rehype-parse";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

import { loadConditionDisease } from "./conditions";
import { loadCreature } from "./creatures";
import { loadFeat } from "./feats";
import { loadItem } from "./items";
import { loadSense } from "./senses";
import { loadSpell } from "./spells";

const FORMAT_TAGS: Record<string, { open: string; close: string }> = {
  b: { open: "<strong>", close: "</strong>" },
  bold: { open: "<strong>", close: "</strong>" },
  i: { open: "<em>", close: "</em>" },
  italic: { open: "<em>", close: "</em>" },
};

const REFERENCE_TAGS = new Set([
  "condition",
  "creature",
  "disease",
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
      span: [
        "ariaDescribedBy",
        "className",
        "id",
        "role",
        "tabIndex",
        "tabindex",
      ],
      strong: ["className"],
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncatePlain(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
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

type TooltipReference = {
  heading: string;
  summaryLines: string[];
  body: string;
};

function resolveReferenceTag(
  tag: string,
  name: string,
  src: string,
): TooltipReference | null {
  switch (tag) {
    case "condition":
    case "disease": {
      const resolved = loadConditionDisease(name, src || undefined);
      if (!resolved) return null;
      return {
        heading: resolved.record.name ?? name,
        summaryLines: resolved.summaryLines,
        body: resolved.body,
      };
    }
    case "creature": {
      const resolved = loadCreature(name, src || undefined);
      if (!resolved) return null;
      return {
        heading: resolved.record.name ?? name,
        summaryLines: resolved.summaryLines,
        body: resolved.body,
      };
    }
    case "feat": {
      const resolved = loadFeat(name, src || "XPHB") ?? loadFeat(name, "PHB");
      if (!resolved) return null;
      return {
        heading: resolved.record.name ?? name,
        summaryLines: resolved.summaryLines,
        body: resolved.body,
      };
    }
    case "item": {
      const resolved = loadItem(name, src || undefined);
      if (!resolved) return null;
      return {
        heading: resolved.record.name ?? name,
        summaryLines: resolved.summaryLines,
        body: resolved.body,
      };
    }
    case "sense": {
      const resolved = loadSense(name, src || undefined);
      if (!resolved) return null;
      return {
        heading: resolved.record.name ?? name,
        summaryLines: resolved.summaryLines,
        body: resolved.body,
      };
    }
    case "spell": {
      const resolved = loadSpell(name, src || undefined);
      if (!resolved) return null;
      return {
        heading: resolved.record.name ?? name,
        summaryLines: resolved.summaryLines,
        body: resolved.body,
      };
    }
    default:
      return null;
  }
}

function renderTooltipReference(
  tag: string,
  label: string,
  resolved: TooltipReference,
): string {
  const tipId = `bf5e-tip-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const summary = resolved.summaryLines
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("");
  const body = truncatePlain(resolved.body, 1200);

  return [
    `<span class="bf5e-ref-wrap">`,
    `<span class="bf5e-ref bf5e-ref--inline bf5e-ref--${tag}" tabindex="0" aria-describedby="${tipId}">${escapeHtml(label)}</span>`,
    `<span id="${tipId}" role="tooltip" class="bf5e-tip bf5e-tip--inline">`,
    `<span class="bf5e-tip__heading">${escapeHtml(resolved.heading)}</span>`,
    summary ? `<span class="bf5e-tip__summary">${summary}</span>` : "",
    body ? `<span class="bf5e-tip__body">${escapeHtml(body)}</span>` : "",
    `</span>`,
    `</span>`,
  ].join("");
}

function renderReferenceTag(tag: string, text: string): string {
  const label = displayTextFromThirdPipe(text);
  const [name = "", src = ""] = splitTagText(text);
  const resolved = resolveReferenceTag(tag, name, src);
  if (!resolved) {
    return `<span class="bf5e-ref bf5e-ref--inline bf5e-ref--${tag}">${escapeHtml(label)}</span>`;
  }

  return renderTooltipReference(tag, label, resolved);
}

function render5eTags(input: string): string {
  return input.replace(/\{@(\w+)\s+([^{}]+)\}/g, (_match, rawTag, rawText) => {
    const tag = String(rawTag).toLowerCase();
    const formatTag = FORMAT_TAGS[tag];
    if (REFERENCE_TAGS.has(tag)) return renderReferenceTag(tag, rawText);
    if (MECHANICS_TAGS.has(tag)) {
      return `<strong class="bf5e-mechanic"><em>${formatMechanicTag(tag, rawText)}</em></strong>`;
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
