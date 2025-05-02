import { resolve } from "node:path";
import type { LocalContext } from "../../../context";
import type { TemplateData } from "../../../lib/template";
import type { NewCommandFlags } from "../commands";
import renderTemplate from "../../../lib/template";

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
  }
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
    tags,
  };

  try {
    const targetDir = resolve(this.rootDir, "../astro/src/content/docs/locations")
    const template = resolve(this.rootDir, "dist/templates/location.ejs")
    await renderTemplate({
      name: articleName,
      template,
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