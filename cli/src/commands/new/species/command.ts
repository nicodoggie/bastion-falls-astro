import { buildCommand, type FlagParametersForType } from "@stricli/core";
import { SpeciesSchema, type Species } from "@bastion-falls/types";
import type { NewCommandFlags } from "../commands.js";

type SpeciesBiome = NonNullable<Species["biomes"]>[number];

export interface NewSpeciesCommandFlags extends NewCommandFlags {
  type?: string;
  origin?: string;
  lifespan?: string;
  locations?: string[];
  biomes?: SpeciesBiome[];
  traits?: string[];
  diet?: string[];
}

const csvList = (value: string) =>
  value.split(",").map((s) => s.trim());
const SpeciesBiomeSchema = SpeciesSchema.shape.biomes.unwrap().element;
const csvBiomeList = (value: string) =>
  csvList(value).map((biome) => SpeciesBiomeSchema.parse(biome));

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
          parse: csvBiomeList,
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
