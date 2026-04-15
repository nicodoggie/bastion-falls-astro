import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import type { NewCommandFlags } from "../commands.js";
import type { Species } from "@bastion-falls/types";
import { getTargetPath } from "@/config.js";

interface NewSpeciesCommandFlags extends NewCommandFlags {
  type?: string;
  origin?: string;
  lifespan?: string;
  locations?: string[];
  biomes?: string[];
  traits?: string[];
  diet?: string[];
}

interface SpeciesTemplate extends TemplateData {
  species: Omit<Species, "name" | "image">;
}

export default async function species(
  this: LocalContext,
  flags: NewSpeciesCommandFlags,
  articleName: string
): Promise<void> {
  console.log("Creating species", articleName);
  const {
    type,
    origin,
    lifespan,
    locations,
    biomes,
    traits,
    diet,
    tags,
    force = false,
  } = flags;

  const data: SpeciesTemplate = {
    title: articleName,
    species: {
      type,
      origin,
      lifespan,
      locations,
      biomes,
      traits,
      diet,
    },
    tags: ["species", ...(tags ?? [])],
  };

  try {
    const targetDir = getTargetPath("species");
    console.log(targetDir);
    await renderTemplate({
      name: articleName,
      template: "species",
      targetDir,
      extension: "mdx",
      data,
      force,
    });
    console.log(`Created ${articleName} at ${targetDir}`);
  } catch (e) {
    console.log("Error creating species", e);
    process.exit(1);
  }
}
