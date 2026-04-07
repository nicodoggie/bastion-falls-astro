import {
  buildCommand,
  type FlagParametersForType,
} from "@stricli/core";
import { type NewCommandFlags } from "../commands.js";
import type { LocationType } from "@bastion-falls/types/Location";

export const locationCommandBuilder = (
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
          parse: (value: string) => value as LocationType,
          brief: "Type of the location (e.g. city, region, river)",
          optional: true,
        },
        parents: {
          kind: "parsed",
          parse: (value: string) => value.split(","),
          brief: "Parent locations of the location",
          optional: true,
        },
        related: {
          kind: "parsed",
          parse: (value: string) => value.split(","),
          brief: "Related locations",
          optional: true,
        },
        area: {
          kind: "parsed",
          parse: (value: string) => {
            const area = parseInt(value);
            if (isNaN(area)) {
              throw new Error("Area must be a number");
            }
            return `${area.toLocaleString("en-US")} sq.ft.`;
          },
          brief: "Area of the location",
          optional: true,
        },
        population: {
          kind: "parsed",
          parse: (value: string) => {
            const pop = parseInt(value);
            if (isNaN(pop)) {
              throw new Error("Population must be a number");
            }
            return pop.toLocaleString("en-US");
          },
          brief: "Population of the location",
          optional: true,
        },
        elevation: {
          kind: "parsed",
          parse: (value: string) => {
            const elevation = parseInt(value);
            if (isNaN(elevation)) {
              throw new Error("Elevation must be a number");
            }
            return `${elevation.toLocaleString("en-US")} ft.`;
          },
          brief: "Elevation of the location",
          optional: true,
        },
        climate: {
          kind: "parsed",
          parse: String,
          brief: "Climate of the location",
          optional: true,
        },
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: String,
            brief: "Name of the location to create",
          },
        ],
      },
    },
    docs: {
      brief: "Create a new location",
    },
  });
