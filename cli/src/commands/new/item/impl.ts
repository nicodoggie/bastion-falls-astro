import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import { getTargetPath } from "@/config.js";
import type { Item } from "@bastion-falls/types/Item";
import type { NewItemFlags } from "./command.js";

type ItemTemplateItem = Omit<Item, "image">;
type ItemDetails = NonNullable<Item["details"]>;

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

  const rawDetails: ItemDetails = {
    attunement,
    type,
    rarity,
    weight,
    value,
  };

  const detailEntries = Object.entries(rawDetails).filter(([, value]) => value !== undefined);
  const details = detailEntries.length > 0
    ? Object.fromEntries(detailEntries) as ItemDetails
    : undefined;

  const data: ItemTemplate = {
    title: articleName,
    item: {
      name: articleName,
      ddb,
      details,
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
