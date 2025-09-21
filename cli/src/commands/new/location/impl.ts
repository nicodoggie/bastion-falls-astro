import { resolve } from "node:path";
import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import type { NewCommandFlags } from "../commands.js";

interface NewLocationCommandFlags extends NewCommandFlags {
  area?: string;
  population?: number;
  elevation?: string;
  parents?: string[];
}

interface LocationDetails {
  parents?: string[];
  details: {
    area?: string;
    population?: number;
    elevation?: string;
  }
}

export interface NewLocationData extends TemplateData {
  extraMetadata: {
    location: LocationDetails;
  };
  tags: string[];
}

export default async function location(this: LocalContext, flags: NewLocationCommandFlags, articleName: string): Promise<void> {
  const { parents, area, population, elevation, tags, force = false } = flags;
  const data: NewLocationData = {
    extraMetadata: {
      location: {
        parents,
        details: { area, population, elevation },
      },
    },
    tags: ["locations", ...(tags ?? [])],
  };

  try {
    const targetDir = resolve(this.rootDir, "../astro/src/content/docs/locations")
    await renderTemplate({
      name: articleName,
      template: "location",
      targetDir,
      extension: "mdx",
      data,
      force,
    })
    console.log(`Created ${articleName} at ${targetDir}`);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }

}