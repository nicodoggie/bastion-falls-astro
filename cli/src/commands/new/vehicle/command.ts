import { buildCommand, numberParser, type FlagParametersForType } from "@stricli/core";
import type { NewCommandFlags } from "../commands.js";

export interface NewVehicleCommandFlags extends NewCommandFlags {
  type: string;
  travelPace: number;
  crew: number;
  passengers?: number;
  cargo?: number;
  size: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

const sizeValues = [
  "tiny",
  "small",
  "medium",
  "large",
  "huge",
  "gargantuan",
] as const;

export const vehicleCommandBuilder = (
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
          brief: "Vehicle type (e.g. sailing ship, caravel, cart)",
        },
        travelPace: {
          kind: "parsed",
          parse: numberParser,
          brief: "Travel pace in miles per hour",
        },
        crew: {
          kind: "parsed",
          parse: numberParser,
          brief: "Required crew size",
        },
        passengers: {
          kind: "parsed",
          parse: numberParser,
          brief: "Passenger capacity",
          optional: true,
        },
        cargo: {
          kind: "parsed",
          parse: numberParser,
          brief: "Cargo capacity (tons)",
          optional: true,
        },
        size: {
          kind: "enum",
          values: sizeValues,
          brief: "Creature size category",
          default: "gargantuan",
        },
        strength: {
          kind: "parsed",
          parse: numberParser,
          brief: "Strength score",
          default: "0",
        },
        dexterity: {
          kind: "parsed",
          parse: numberParser,
          brief: "Dexterity score",
          default: "0",
        },
        constitution: {
          kind: "parsed",
          parse: numberParser,
          brief: "Constitution score",
          default: "0",
        },
        intelligence: {
          kind: "parsed",
          parse: numberParser,
          brief: "Intelligence score",
          default: "0",
        },
        wisdom: {
          kind: "parsed",
          parse: numberParser,
          brief: "Wisdom score",
          default: "0",
        },
        charisma: {
          kind: "parsed",
          parse: numberParser,
          brief: "Charisma score",
          default: "0",
        },
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: String,
            brief: "Name of the vehicle to create",
          },
        ],
      },
    },
    docs: {
      brief: "Create a new vehicle",
    },
  });
