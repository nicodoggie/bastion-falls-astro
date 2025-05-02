import { buildRouteMap, type FlagParametersForType, } from "@stricli/core";
import { locationCommandBuilder } from "./location/command";
import { characterCommandBuilder } from "./character/command";

export interface NewCommandFlags {
  force?: boolean;
  tags?: string[];
}

export const defaultFlags: FlagParametersForType<NewCommandFlags> = {
  force: {
    kind: "boolean",
    brief: "Force the creation of the location",
    optional: true,
  },
  tags: {
    kind: "parsed",
    parse: (value: string) => value.split(","),
    brief: "Tags to add to the location",
    optional: true,
  },
}

const locationCommand = locationCommandBuilder(defaultFlags);
const characterCommand = characterCommandBuilder(defaultFlags);
export const newCommandRoutes = buildRouteMap({
  routes: {
    loc: locationCommand,
    location: locationCommand,
    locations: locationCommand,
    char: characterCommand,
    character: characterCommand,
    characters: characterCommand,
  },
  docs: {
    brief: "Create a new article",
  },
});