import { buildRouteMap, type FlagParametersForType, } from "@stricli/core";
import { locationCommandBuilder } from "./location/command.js";
import { characterCommandBuilder } from "./character/command.js";
import { eventCommandBuilder } from "./event/command.js";
import { familyCommandBuilder } from "./family/command.js";
import { vehicleCommandBuilder } from "./vehicle/command.js";
import { speciesCommandBuilder } from "./species/command.js";
import { organizationCommandBuilder } from "./organization/command.js";

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
const eventCommand = eventCommandBuilder(defaultFlags);
const familyCommand = familyCommandBuilder(defaultFlags);
const vehicleCommand = vehicleCommandBuilder(defaultFlags);
const speciesCommand = speciesCommandBuilder(defaultFlags);
const organizationCommand = organizationCommandBuilder(defaultFlags);

export const newCommandRoutes = buildRouteMap({
  routes: {
    loc: locationCommand,
    location: locationCommand,
    locations: locationCommand,
    cha: characterCommand,
    character: characterCommand,
    characters: characterCommand,
    event: eventCommand,
    events: eventCommand,
    evt: eventCommand,
    fam: familyCommand,
    family: familyCommand,
    families: familyCommand,
    veh: vehicleCommand,
    vehicle: vehicleCommand,
    vehicles: vehicleCommand,
    spe: speciesCommand,
    species: speciesCommand,
    org: organizationCommand,
    organization: organizationCommand,
    organizations: organizationCommand,
  },
  docs: {
    brief: "Create a new article",
  },
});