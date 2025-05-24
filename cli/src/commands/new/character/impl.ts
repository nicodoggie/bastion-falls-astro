import type { LocalContext } from "@/context.js";
import { resolve } from "path";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import { type NewCommandFlags } from "../commands.js";
import type { Character } from "@bastion-falls/types";
import type { CharacterOrganization, CharacterRelative, CharacterReligion } from "@bastion-falls/types/Character";
import type { ImageAttribution } from "@bastion-falls/types/Image";

interface NewCharacterCommandFlags extends NewCommandFlags {
  ddb?: string;
  imageUrl?: string;
  attribution?: string;
  attributionUrl?: string;
  age?: number;
  aliases?: string[];
  dateOfBirth?: string;
  dateOfDeath?: string;
  parents?: string[];
  sex?: string;
  pronouns?: string;
  height?: string;
  weight?: string;
}

interface CharacterTemplate extends TemplateData {
  character: Omit<Character, "name">;
}


export default async function character(this: LocalContext, flags: NewCharacterCommandFlags, articleName: string): Promise<void> {
  const {
    ddb,
    imageUrl,
    attribution,
    attributionUrl,
    age,
    aliases,
    dateOfBirth,
    dateOfDeath,
    parents = [],
    tags,
    force = false,
  } = flags;

  const image: ImageAttribution | undefined = imageUrl ? {
    url: imageUrl,
    attribution,
    attributionUrl,
  } : undefined;
  
  const relatives: CharacterRelative[] = [
    ...(parents.map((parent): CharacterRelative => ({ name: parent, type: "parent" }))),
  ];
  const religions: CharacterReligion[] = [];
  const organizations: CharacterOrganization[] = [];

  const data: CharacterTemplate = {
    title: articleName,
    character: {
      ddb,
      image,
      details: {
        age,
        aliases: aliases ?? [],
        dateOfBirth,
        dateOfDeath,
        sex: undefined,
        pronouns: undefined,
        height: undefined,
        weight: undefined,
      },
      relationships: {  
        organizations,
        relatives,
        religions,
      },
    },
    tags: [
      "characters",
      ...(tags ?? []),
    ]
  };

  try {
    const targetDir = resolve(this.rootDir, "../astro/src/content/docs/characters")
    await renderTemplate({
      name: articleName,
      template: "character",
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
