import { buildCommand, numberParser, type FlagParametersForType } from "@stricli/core";
import { type NewCommandFlags } from "../commands.js";

export const characterCommandBuilder = (parentFlags: FlagParametersForType<NewCommandFlags>) => buildCommand({
  loader: async () => {
    return await import("./impl.js");
  },
  parameters: {
    flags: {
      ...parentFlags,
      ddb: {
        kind: "parsed",
        parse: (value: string) => {
          if (!value.startsWith("https://www.dndbeyond.com/characters/")) {
            throw new Error("D&D Beyond URL must start with https://www.dndbeyond.com/characters/");
          }
          return value;
        },
        brief: "D&D Beyond URL",
        optional: true,
      },
      imageUrl: {
        kind: "parsed",
        parse: String,
        brief: "Character portrait image URL",
        optional: true,
      },
      attribution: {
        kind: "parsed",
        parse: String,
        brief: "Attribution for the character portrait image",
        optional: true,
      },
      attributionUrl: {
        kind: "parsed",
        parse: String,
        brief: "URL for the attribution of the character portrait image",
        optional: true,
      },
      age: {
        kind: "parsed",
        parse: numberParser,
        brief: "Age",
        optional: true,
      },
      aliases: {
        kind: "parsed",
        parse: (value: string) => value.split(",").map((alias) => alias.trim()),
        brief: "Character's known aliases",
        optional: true,
      },
      dateOfBirth: {
        kind: "parsed",
        parse: String,
        brief: "Date of birth",
        optional: true,
      },
      dateOfDeath: {
        kind: "parsed",
        parse: String,
        brief: "Date of death",
        optional: true,
      },
      parents: {
        kind: "parsed",
        parse: (value: string) => value.split(",").map((parent) => parent.trim()),
        brief: "Parent characters",
        optional: true,
      },
      sex: {
        kind: "parsed",
        parse: String,
        brief: "Sex",
        optional: true,
      },
      pronouns: {
        kind: "parsed",
        parse: String,
        brief: "Pronouns",
        optional: true,
      },
      height: {
        kind: "parsed",
        parse: (value: string) => {
          const height = parseInt(value);
          if (isNaN(height)) {
            throw new Error("Height must be a number");
          }
          return `${height.toLocaleString('en-US')} ft.`;
        },
        brief: "Height",
        optional: true,
      },
      weight: {
        kind: "parsed",
        parse: (value: string) => {
          const weight = parseInt(value);
          if (isNaN(weight)) {
            throw new Error("Weight must be a number");
          }
          return `${weight.toLocaleString('en-US')} lbs.`;
        },
        brief: "Weight",
        optional: true,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Name of the character to create",
        },
      ],
    },
  },
  docs: {
    brief: "Create a new character",
  },
});