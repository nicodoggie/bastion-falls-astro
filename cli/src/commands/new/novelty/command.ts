import { buildCommand, type FlagParametersForType } from "@stricli/core";
import type { NewCommandFlags } from "../commands.js";

export interface NewNoveltyCommandFlags extends NewCommandFlags {
  description?: string;
}

export const noveltyCommandBuilder = (
  parentFlags: FlagParametersForType<NewCommandFlags>,
) =>
  buildCommand({
    loader: async () => {
      return await import("./impl.js");
    },
    parameters: {
      flags: {
        ...parentFlags,
        description: {
          kind: "parsed",
          parse: String,
          brief: "Short description of the novelty",
          optional: true,
        },
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: String,
            brief: "Title of the in-world novelty to create",
          },
        ],
      },
    },
    docs: {
      brief: "Create a new world novelty (poem, article, ephemera, etc.)",
    },
  });
