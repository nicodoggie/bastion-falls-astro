import {
  buildCommand,
  type FlagParametersForType,
} from "@stricli/core";
import type { NewCommandFlags } from "../commands.js";

export interface NewItemFlags extends NewCommandFlags {
  ddb?: string;
  attunement?: boolean;
  type?: string;
  rarity?: string;
  weight?: string;
  value?: string;
}

export const itemCommandBuilder = (
  parentFlags: FlagParametersForType<NewCommandFlags>
) =>
  buildCommand({
    loader: async () => {
      return await import("./impl.js");
    },
    parameters: {
      flags: {
        ...parentFlags,
        ddb: {
          kind: "parsed",
          parse: String,
          brief: "D&D Beyond URL for the item",
          optional: true,
        },
        attunement: {
          kind: "boolean",
          brief: "Whether the item requires attunement",
          optional: true,
        },
        type: {
          kind: "parsed",
          parse: String,
          brief: "Item type (e.g. wondrous item, weapon, armor)",
          optional: true,
        },
        rarity: {
          kind: "parsed",
          parse: String,
          brief: "Item rarity (e.g. common, uncommon, rare)",
          optional: true,
        },
        weight: {
          kind: "parsed",
          parse: String,
          brief: "Item weight (e.g. 3 lbs)",
          optional: true,
        },
        value: {
          kind: "parsed",
          parse: String,
          brief: "Item value (e.g. 1,000 gp)",
          optional: true,
        },
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: String,
            brief: "Name of the item to create",
          },
        ],
      },
    },
    docs: {
      brief: "Create a new item",
    },
  });
