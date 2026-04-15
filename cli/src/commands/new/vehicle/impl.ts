import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import type { NewCommandFlags } from "../commands.js";
import type { Vehicle } from "@bastion-falls/types";
import { getTargetPath } from "@/config.js";

interface NewVehicleCommandFlags extends NewCommandFlags {
  type: string;
  travelPace: number;
  crew: number;
  passengers?: number;
  cargo?: number;
  size: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

interface VehicleTemplate extends TemplateData {
  vehicle: Omit<Vehicle, "name" | "crew" | "actions" | "sections">;
}

export default async function vehicle(
  this: LocalContext,
  flags: NewVehicleCommandFlags,
  articleName: string
): Promise<void> {
  console.log("Creating vehicle", articleName);
  const {
    type,
    travelPace,
    crew,
    passengers,
    cargo,
    size,
    strength,
    dexterity,
    constitution,
    intelligence,
    wisdom,
    charisma,
    tags,
    force = false,
  } = flags;

  const data: VehicleTemplate = {
    title: articleName,
    vehicle: {
      type,
      travelPace,
      capacity: {
        crew,
        passengers,
        cargo,
      },
      stats: {
        size,
        strength,
        dexterity,
        constitution,
        intelligence,
        wisdom,
        charisma,
      },
    },
    tags: ["vehicles", ...(tags ?? [])],
  };

  try {
    const targetDir = getTargetPath("vehicles");
    console.log(targetDir);
    await renderTemplate({
      name: articleName,
      template: "vehicle",
      targetDir,
      extension: "mdx",
      data,
      force,
    });
    console.log(`Created ${articleName} at ${targetDir}`);
  } catch (e) {
    console.log("Error creating vehicle", e);
    process.exit(1);
  }
}
