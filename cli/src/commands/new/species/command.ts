import { buildCommand, type FlagParametersForType } from "@stricli/core";
import type { NewCommandFlags } from "../commands.js";

export interface NewSpeciesCommandFlags extends NewCommandFlags {
  type?: string;
  origin?: string;
  lifespan?: string;
  locations?: string[];
  biomes?: string[];
  traits?: string[];
  diet?: string[];
}

const csvList = (value: string) =>
  value.split(",").map((s) => s.trim());

export const speciesCommandBuilder = (
  parentFlags: FlagParametersForType<NewCommandFlags>
) =>
  buildCommand({
    loader: async () => {
      return await import("./impl.js");
    },
    parameters: {
      flags: {
        ...parentFlags,
        type: {
          kind: "parsed",
          parse: String,
          brief: "Creature type (e.g. humanoid, celestial, beast)",
          optional: true,
        },
        origin: {
          kind: "parsed",
          parse: String,
          brief: "Where the species originates from",
          optional: true,
        },
        lifespan: {
          kind: "parsed",
          parse: String,
          brief: "Typical lifespan (e.g. 80 years, Immortal)",
          optional: true,
        },
        locations: {
          kind: "parsed",
          parse: csvList,
          brief: "Comma-separated list of known locations",
          optional: true,
        },
        biomes: {
          kind: "parsed",
          parse: csvList,
          brief: "Comma-separated list of biomes inhabited",
          optional: true,
        },
        traits: {
          kind: "parsed",
          parse: csvList,
          brief: "Comma-separated list of notable traits",
          optional: true,
        },
        diet: {
          kind: "parsed",
          parse: csvList,
          brief: "Comma-separated list of diet items",
          optional: true,
        },
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: String,
            brief: "Name of the species to create",
          },
        ],
      },
    },
    docs: {
      brief: "Create a new species",
    },
  });
