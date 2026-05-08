import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import { getTargetPath } from "@/config.js";
import type { Item } from "@bastion-falls/types/Item";
import type { NewItemFlags } from "./command.js";

type ItemTemplateItem = Omit<Item, "image">;

interface ItemTemplate extends TemplateData {
  item: ItemTemplateItem;
}

export default async function item(
  this: LocalContext,
  flags: NewItemFlags,
  articleName: string
): Promise<void> {
  const {
    ddb,
    attunement,
    type,
    rarity,
    weight,
    value,
    tags,
    force = false,
  } = flags;

  const rawDetails: NonNullable<Item["details"]> = {
    attunement,
    type,
    rarity,
    weight,
    value,
  };

  const details = Object.fromEntries(
    Object.entries(rawDetails).filter(
      (entry): entry is [string, NonNullable<Item["details"]>[string]] =>
        entry[1] !== undefined
    )
  ) as Item["details"];

  const data: ItemTemplate = {
    title: articleName,
    item: {
      name: articleName,
      ddb,
      details: details && Object.keys(details).length > 0 ? details : undefined,
    },
    tags: ["items", ...(tags ?? [])],
  };

  try {
    const targetDir = getTargetPath("items");
    await renderTemplate({
      name: articleName,
      template: "item",
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
