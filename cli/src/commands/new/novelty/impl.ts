import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import type { NewCommandFlags } from "../commands.js";
import { getTargetPath } from "@/config.js";
import type { Novelty } from "@bastion-falls/types";

interface NewNoveltyCommandFlags extends NewCommandFlags {
  description?: string;
}

interface NoveltyTemplate extends TemplateData {
  description?: Novelty["description"];
}

export default async function novelty(
  this: LocalContext,
  flags: NewNoveltyCommandFlags,
  articleName: string,
): Promise<void> {
  const { description, tags, force = false } = flags;

  const data: NoveltyTemplate = {
    title: articleName,
    description,
    tags: ["world-novelty", ...(tags ?? [])],
  };

  try {
    const targetDir = getTargetPath("novelty");
    await renderTemplate({
      name: articleName,
      template: "novelty",
      targetDir,
      extension: "mdx",
      data,
      force,
    });
    console.log(`Created ${articleName} at ${targetDir}`);
  } catch (e) {
    console.log("Error creating novelty", e);
    process.exit(1);
  }
}
