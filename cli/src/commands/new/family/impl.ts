import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import type { NewCommandFlags } from "../commands.js";
import type { Family } from "@bastion-falls/types";
import { getTargetPath } from "@/config.js";

interface NewFamilyCommandFlags extends NewCommandFlags {
  founded?: string;
  dissolved?: string;
  seat?: string;
  motto?: string;
  sigil?: string;
}

interface FamilyTemplate extends TemplateData {
  family: Omit<Family, "name">;
}

export default async function family(
  this: LocalContext,
  flags: NewFamilyCommandFlags,
  articleName: string
): Promise<void> {
  console.log("Creating family", articleName);
  const {
    founded,
    dissolved,
    seat,
    motto,
    sigil,
    tags,
    force = false,
  } = flags;

  const data: FamilyTemplate = {
    title: articleName,
    family: {
      founded,
      dissolved,
      seat,
      motto,
      sigil,
    },
    tags: ["families", ...(tags ?? [])],
  };

  try {
    const targetDir = getTargetPath("families");
    console.log(targetDir);
    await renderTemplate({
      name: articleName,
      template: "family",
      targetDir,
      extension: "mdx",
      data,
      force,
    });
    console.log(`Created ${articleName} at ${targetDir}`);
  } catch (e) {
    console.log("Error creating family", e);
    process.exit(1);
  }
}
