import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import type { NewCommandFlags } from "../commands.js";
import type { LocationType } from "@bastion-falls/types/Location";
import { getTargetPath } from "@/config.js";

interface NewLocationCommandFlags extends NewCommandFlags {
  type?: LocationType;
  parents?: string[];
  related?: string[];
  area?: string;
  population?: string;
  elevation?: string;
  climate?: string;
}

interface LocationTemplate extends TemplateData {
  location: {
    type?: LocationType;
    parents?: string[];
    related?: string[];
    details?: Record<string, string>;
  };
}

export default async function location(
  this: LocalContext,
  flags: NewLocationCommandFlags,
  articleName: string
): Promise<void> {
  const {
    type,
    parents,
    related,
    area,
    population,
    elevation,
    climate,
    tags,
    force = false,
  } = flags;

  const rawDetails: Record<string, string | undefined> = {
    area,
    population,
    elevation,
    climate,
  };
  const details = Object.fromEntries(
    Object.entries(rawDetails).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );

  const data: LocationTemplate = {
    title: articleName,
    location: {
      type,
      parents,
      related,
      details: Object.keys(details).length > 0 ? details : undefined,
    },
    tags: ["locations", ...(tags ?? [])],
  };

  try {
    const targetDir = getTargetPath("locations");
    await renderTemplate({
      name: articleName,
      template: "location",
      targetDir,
      extension: "mdx",
      data,
      force,
    });
    console.log(`Created ${articleName} at ${targetDir}`);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
}
