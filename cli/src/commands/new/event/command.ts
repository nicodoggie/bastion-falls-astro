import { buildCommand, type FlagParametersForType } from "@stricli/core";
import type { NewCommandFlags } from "../commands.js";

export interface NewEventCommandFlags extends NewCommandFlags {
  description?: string;
  type?: string;
  dateStarted?: string;
  dateEnded?: string;
  locations?: string[];
}

export const eventCommandBuilder = (parentFlags: FlagParametersForType<NewCommandFlags>) => buildCommand({
  loader: async () => {
    return await import("./impl.js");
  },
  parameters: {
    flags: {
      ...parentFlags,
      description: {
        kind: "parsed",
        parse: String,
        brief: "The description of the event",
        optional: true,
      },
      type: {
        kind: "parsed",
        parse: String,
        brief: "The type of the event",
        optional: true,
      },
      dateStarted: {
        kind: "parsed",
        parse: String,
        brief: "The date of the event",
        optional: true,
      },
      dateEnded: {
        kind: "parsed",
        parse: String,
        brief: "The date of the event",
        optional: true,
      },
      locations: {
        kind: "parsed",
        parse: (value: string) => value.split(",").map((location) => location.trim()),
        brief: "The locations of the event",
        optional: true,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "The name of the event",
        },
      ],
    },
  },
  docs: {
    brief: "Create a new event",
  },
});
