import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CharacterMortalityInput } from "@bastion-falls/types/CharacterAge";
import {
  getCurrentDeathDate,
  getOriginalBirthDate,
} from "@bastion-falls/types/CharacterAge";

import matter from "gray-matter";

type CollectionName = string;
type TimelineType = "birth" | "death" | "start" | "end" | "discover";
type DefaultDatedCollection =
  | "events"
  | "characters"
  | "organizations"
  | "locations"
  | "religions";

interface TimelineEntry {
  year: string;
  yearSort: number;
  label: string;
  slug: string;
  collection: CollectionName;
  type: TimelineType;
  priority: number;
}

type TimelineOverride = {
  label?: string;
  year?: string;
  type?: TimelineType;
  priority?: number;
  order?: number;
};

type TimelineField = boolean | TimelineOverride | TimelineOverride[];

type Frontmatter = {
  title?: string;
  timeline?: TimelineField;
  event?: {
    dateStarted?: string;
    dateEnded?: string;
  };
  character?: {
    details?: {
      mortality?: CharacterMortalityInput;
    };
  };
  organization?: {
    founded?: string;
    dissolved?: string;
  };
  religion?: {
    founded?: string;
  };
  location?: {
    dateFounded?: string;
    dateDissolved?: string;
    discovered?: string;
    details?: {
      timeline?: {
        start?: string;
        end?: string;
      };
    };
  };
};

const DEFAULT_DATED_COLLECTION_DIRS: Record<DefaultDatedCollection, string> = {
  events: "src/content/docs/world/events",
  characters: "src/content/docs/world/characters",
  organizations: "src/content/docs/world/organizations",
  locations: "src/content/docs/world/locations",
  religions: "src/content/docs/world/religions",
};

const ALL_WORLD_COLLECTION_DIRS = {
  events: "src/content/docs/world/events",
  characters: "src/content/docs/world/characters",
  organizations: "src/content/docs/world/organizations",
  locations: "src/content/docs/world/locations",
  concepts: "src/content/docs/world/concepts",
  families: "src/content/docs/world/families",
  items: "src/content/docs/world/items",
  species: "src/content/docs/world/species",
  vehicles: "src/content/docs/world/vehicles",
  religions: "src/content/docs/world/religions",
} as const;

function parseYear(dateStr: string): { display: string; sort: number } {
  const match = dateStr.match(/^(\d+)(?:-(\d+)-(\d+))?\s*(PF|AI)$/i);
  if (!match) return { display: dateStr, sort: 0 };

  const [, year, , , era] = match;
  const normalizedYear = String(parseInt(year, 10));
  const normalizedEra = era.toUpperCase();
  const sortYear = parseInt(normalizedYear, 10);

  return {
    display: `${normalizedYear} ${normalizedEra}`,
    sort: normalizedEra === "PF" ? -sortYear : sortYear,
  };
}

function getDefaultDateField(
  collection: DefaultDatedCollection,
  data: Frontmatter,
): { date: string; type: TimelineType } | null {
  switch (collection) {
    case "events":
      return data.event?.dateStarted
        ? { date: data.event.dateStarted, type: "start" }
        : data.event?.dateEnded
          ? { date: data.event.dateEnded, type: "end" }
          : null;
    case "characters": {
      const mortality = data.character?.details?.mortality;
      const originalBirth = mortality
        ? getOriginalBirthDate(mortality)
        : undefined;
      const currentDeath = mortality
        ? getCurrentDeathDate(mortality)
        : undefined;
      return originalBirth
        ? { date: originalBirth, type: "birth" }
        : currentDeath
          ? { date: currentDeath, type: "death" }
          : null;
    }
    case "organizations":
      return data.organization?.founded
        ? { date: data.organization.founded, type: "start" }
        : data.organization?.dissolved
          ? { date: data.organization.dissolved, type: "end" }
          : null;
    case "locations":
      return data.location?.dateFounded
        ? { date: data.location.dateFounded, type: "start" }
        : data.location?.dateDissolved
          ? { date: data.location.dateDissolved, type: "end" }
          : data.location?.details?.timeline?.start
            ? { date: data.location.details.timeline.start, type: "start" }
            : data.location?.details?.timeline?.end
              ? { date: data.location.details.timeline.end, type: "end" }
              : data.location?.discovered
                ? { date: data.location.discovered, type: "discover" }
                : null;
    case "religions":
      return data.religion?.founded
        ? { date: data.religion.founded, type: "start" }
        : null;
  }
}

function walkMdxFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMdxFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".mdx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function filePathToSlug(baseDir: string, filePath: string): string {
  const rel = relative(baseDir, filePath).split(sep).join("/");
  if (rel.endsWith("/index.mdx")) return rel.slice(0, -"/index.mdx".length);
  if (rel.endsWith(".mdx")) return rel.slice(0, -".mdx".length);
  return rel;
}

function getCollectionEntries(
  baseDir: string,
): Array<{ slug: string; id: string; data: Frontmatter }> {
  const files = walkMdxFiles(baseDir);

  return files.map((filePath) => {
    try {
      const source = readFileSync(filePath, "utf-8");
      const parsed = matter(source);
      const slug = filePathToSlug(baseDir, filePath);
      return {
        slug,
        id: slug,
        data: parsed.data as Frontmatter,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Timeline: failed reading or parsing frontmatter in ${filePath}: ${detail}`,
        { cause: err },
      );
    }
  });
}

function formatTimelineLabel(
  collection: CollectionName,
  type: TimelineType,
  baseLabel: string,
): string {
  if (collection === "characters") {
    if (type === "birth") return `${baseLabel} was born`;
    if (type === "death") return `${baseLabel} died`;
  }

  if (collection === "organizations") {
    if (type === "start") return `${baseLabel} was founded`;
    if (type === "end") return `${baseLabel} was dissolved`;
  }

  if (collection === "religions") {
    if (type === "start") return `${baseLabel} was founded`;
  }

  if (collection === "locations") {
    if (type === "start") return `${baseLabel} was founded`;
    if (type === "discover") return `${baseLabel} was discovered`;
  }

  return baseLabel;
}

function buildEntryFromOverride(args: {
  collection: CollectionName;
  slug: string;
  id: string;
  title?: string;
  baseType: TimelineType;
  baseDate?: string;
  override: TimelineOverride;
}): TimelineEntry | null {
  const yearRaw = args.override.year || args.baseDate;
  if (!yearRaw) return null;

  const parsedYear = parseYear(yearRaw);
  const type = args.override.type || args.baseType;
  const baseLabel = args.title || args.id;
  const label = args.override.label
    ? args.override.label
    : formatTimelineLabel(args.collection, type, baseLabel);
  const priority = args.override.priority ?? args.override.order ?? 999;

  return {
    year: parsedYear.display,
    yearSort: parsedYear.sort,
    label,
    slug: args.slug || args.id,
    collection: args.collection,
    type,
    priority,
  };
}

async function getTimelineEntries(): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];

  for (const [coll, baseDir] of Object.entries(ALL_WORLD_COLLECTION_DIRS)) {
    const collEntries = getCollectionEntries(baseDir);

    for (const entry of collEntries) {
      const timeline = entry.data.timeline;
      const isDefaultDatedCollection = coll in DEFAULT_DATED_COLLECTION_DIRS;
      const defaultDateInfo = isDefaultDatedCollection
        ? getDefaultDateField(coll as DefaultDatedCollection, entry.data)
        : null;

      if (timeline === false) continue;
      if (timeline === undefined && coll !== "events") continue;

      if (Array.isArray(timeline)) {
        for (const override of timeline) {
          const built = buildEntryFromOverride({
            collection: coll,
            slug: entry.slug,
            id: entry.id,
            title: entry.data.title,
            baseType: defaultDateInfo?.type || "start",
            baseDate: defaultDateInfo?.date,
            override,
          });
          if (built) entries.push(built);
        }
        continue;
      }

      if (coll === "events" && (timeline === undefined || timeline === true)) {
        const baseLabel = entry.data.title || entry.id;
        const started = entry.data.event?.dateStarted;
        const ended = entry.data.event?.dateEnded;

        if (started && ended) {
          const startEntry = buildEntryFromOverride({
            collection: coll,
            slug: entry.slug,
            id: entry.id,
            title: entry.data.title,
            baseType: "start",
            baseDate: started,
            override: {
              year: started,
              type: "start",
              label: `${baseLabel} started`,
            },
          });
          if (startEntry) entries.push(startEntry);

          const endEntry = buildEntryFromOverride({
            collection: coll,
            slug: entry.slug,
            id: entry.id,
            title: entry.data.title,
            baseType: "end",
            baseDate: ended,
            override: {
              year: ended,
              type: "end",
              label: `${baseLabel} ended`,
            },
          });
          if (endEntry) entries.push(endEntry);
          continue;
        }
      }

      if (timeline === true) {
        if (!defaultDateInfo) continue;
        const built = buildEntryFromOverride({
          collection: coll,
          slug: entry.slug,
          id: entry.id,
          title: entry.data.title,
          baseType: defaultDateInfo.type,
          baseDate: defaultDateInfo.date,
          override: {},
        });
        if (built) entries.push(built);
        continue;
      }

      if (timeline === undefined) {
        if (!defaultDateInfo) continue;
        const built = buildEntryFromOverride({
          collection: coll,
          slug: entry.slug,
          id: entry.id,
          title: entry.data.title,
          baseType: defaultDateInfo.type,
          baseDate: defaultDateInfo.date,
          override: {},
        });
        if (built) entries.push(built);
        continue;
      }

      const built = buildEntryFromOverride({
        collection: coll,
        slug: entry.slug,
        id: entry.id,
        title: entry.data.title,
        baseType: defaultDateInfo?.type || timeline.type || "start",
        baseDate: defaultDateInfo?.date,
        override: timeline,
      });
      if (built) entries.push(built);
    }
  }

  entries.sort((a, b) => {
    if (a.yearSort !== b.yearSort) return a.yearSort - b.yearSort;
    if (a.year !== b.year) return a.year.localeCompare(b.year);
    return a.priority - b.priority;
  });

  return entries;
}

function generateTimelineMDX(entries: TimelineEntry[]): string {
  const pathMap: Record<string, string> = {
    events: "world/events",
    characters: "world/characters",
    organizations: "world/organizations",
    locations: "world/locations",
    concepts: "world/concepts",
    families: "world/families",
    items: "world/items",
    species: "world/species",
    vehicles: "world/vehicles",
    religions: "world/religions",
  };

  const grouped = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const row = grouped.get(entry.year);
    if (row) {
      row.push(entry);
    } else {
      grouped.set(entry.year, [entry]);
    }
  }

  const rows = Array.from(grouped.entries())
    .map(([year, yearEntries]) => {
      const events = yearEntries
        .map((entry) => {
          const basePath =
            pathMap[entry.collection] || `world/${entry.collection}`;
          const href = `/${basePath}/${entry.slug}/`;
          return `        <li>[${entry.label}](${href})</li>`;
        })
        .join("\n");

      return `    <tr>\n      <td>${year}</td>\n      <td>\n        <ul>\n${events}\n        </ul>\n      </td>\n    </tr>`;
    })
    .join("\n");

  return `---
title: Timeline of Events
---

<table>
  <thead>
    <tr>
      <th>Year</th>
      <th>Events</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
`;
}

export { generateTimelineMDX, getTimelineEntries, type TimelineEntry };
