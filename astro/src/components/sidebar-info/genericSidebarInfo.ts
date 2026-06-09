const GENERIC_SIDEBAR_KEYS = [
  "concept",
  "event",
  "religion",
  "species",
] as const;

const SPECIFIC_SIDEBAR_KEYS = [
  "character",
  "family",
  "item",
  "location",
  "organization",
] as const;

export interface GenericSidebarSubject {
  data: Record<string, unknown>;
  key: (typeof GENERIC_SIDEBAR_KEYS)[number];
  title: string;
}

export interface GenericSidebarRowText {
  kind: "text";
  label: string;
  layout: "inline";
  text: string;
}

export interface GenericSidebarRowList {
  items: string[];
  kind: "list";
  label: string;
  layout: "stacked";
}

export type GenericSidebarRow = GenericSidebarRowText | GenericSidebarRowList;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function titleCasePart(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatSidebarLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((part) => titleCasePart(part))
    .join(" ");
}

export function getGenericSidebarSubject(
  entryData: Record<string, unknown>,
): GenericSidebarSubject | null {
  if (
    SPECIFIC_SIDEBAR_KEYS.some(
      (key) => key in entryData && entryData[key] != null,
    )
  ) {
    return null;
  }

  for (const key of GENERIC_SIDEBAR_KEYS) {
    const value = entryData[key];
    if (!isRecord(value)) continue;

    const title =
      typeof entryData.title === "string"
        ? entryData.title
        : typeof value.name === "string"
          ? value.name
          : typeof value.title === "string"
            ? value.title
            : null;

    if (title) {
      return { data: value, key, title };
    }
  }

  return null;
}

export function buildGenericSidebarRows(
  data: Record<string, unknown>,
): GenericSidebarRow[] {
  const textRows: GenericSidebarRowText[] = [];
  const listRows: GenericSidebarRowList[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value == null || key === "image" || key === "name" || key === "title") {
      continue;
    }

    const label = formatSidebarLabel(key);

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      textRows.push({
        kind: "text",
        label,
        layout: "inline",
        text: `${value}`,
      });
      continue;
    }

    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      if (value.length === 0) continue;
      listRows.push({
        items: value,
        kind: "list",
        label,
        layout: "stacked",
      });
    }
  }

  textRows.sort((a, b) => a.label.localeCompare(b.label));
  listRows.sort((a, b) => a.label.localeCompare(b.label));

  return [...textRows, ...listRows];
}

export function getGenericSidebarImage(
  data: Record<string, unknown>,
): Record<string, unknown> | Record<string, unknown>[] | undefined {
  if (isRecord(data.image)) return data.image;
  if (Array.isArray(data.image) && data.image.every(isRecord)) {
    return data.image;
  }
  return undefined;
}
