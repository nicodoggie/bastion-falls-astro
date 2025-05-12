import { buildCommand, numberParser, type FlagParametersForType } from "@stricli/core";
import { type NewCommandFlags } from "../commands.js";

export const locationCommandBuilder = (parentFlags: FlagParametersForType<NewCommandFlags>) => buildCommand({
  loader: async () => {
    return await import("./impl.js");
  },
  parameters: {
    flags: {
      ...parentFlags,
      parents: {
        kind: "parsed",
        parse: (value: string) => value.split(","),
        brief: "Parent locations of the location",
        optional: true,
      },
      area: {
        kind: "parsed",
        parse: (value: string) => {
          const area = parseInt(value);
          if (isNaN(area)) {
            throw new Error("Area must be a number");
          }

          return `${area.toLocaleString('en-US')} sq.ft.`;
        },
        brief: "Area of the location",
        optional: true,
      },
      population: {
        kind: "parsed",
        parse: numberParser,
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

          return `${elevation.toLocaleString('en-US')} ft.`;
        },
        brief: "Elevation of the location",
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