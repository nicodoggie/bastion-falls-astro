import type { LocalContext } from "../../../context";
import { resolve } from "path";
import * as YAML from "js-yaml";
import renderTemplate, { type TemplateData } from "../../../lib/template";
import { type NewCommandFlags } from "../commands";

interface NewCharacterCommandFlags extends NewCommandFlags {
  ddb?: string;
  imageUrl?: string;
  attribution?: string;
  attributionUrl?: string;
  age?: number;
  aliases?: string[];
  date_of_birth?: string;
  date_of_death?: string;
  parents?: string[];
  sex?: string;
  pronouns?: string;
  height?: string;
  weight?: string;
}

interface ImageDetails {
  url?: string;
  attribution?: string;
  attribution_url?: string;
}

interface CharacterDetails {
  age?: number;
  aliases?: string[];
  date_of_birth?: string;
  date_of_death?: string;
  sex?: string;
  pronouns?: string;
  height?: string;
  weight?: string;
}

export interface NewCharacterData extends TemplateData {
  extraMetadata: {
    ddb?: string;
    image?: ImageDetails;
    character: CharacterDetails;
    parents?: string[];
  }
}

export default async function character(this: LocalContext, flags: NewCharacterCommandFlags, articleName: string): Promise<void> {
  const {
    ddb,
    imageUrl,
    attribution,
    attributionUrl,
    age,
    aliases,
    date_of_birth,
    date_of_death,
    parents,
    tags,
    force = false,
  } = flags;

  const data: NewCharacterData = {
    title: articleName,
    extraMetadata: {
      ddb,
      image: {
        url: imageUrl,
        attribution,
        attribution_url: attributionUrl,
      },
      character: {
        age,
        aliases: aliases ?? [],
        date_of_birth,
        date_of_death,
      },
      parents: parents ?? [],
    },
    tags: [
      "characters",
      ...(tags ?? []),
    ]
  };

  try {
    const targetDir = resolve(this.rootDir, "../astro/src/content/docs/characters")
    const template = resolve(this.rootDir, "dist/templates/character.ejs")
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
