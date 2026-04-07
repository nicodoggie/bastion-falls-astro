import { buildCommand, type FlagParametersForType } from "@stricli/core";
import type { NewCommandFlags } from "../commands.js";

export interface NewFamilyCommandFlags extends NewCommandFlags {
  founded?: string;
  dissolved?: string;
  seat?: string;
  motto?: string;
  sigil?: string;
}

export const familyCommandBuilder = (
  parentFlags: FlagParametersForType<NewCommandFlags>
) =>
  buildCommand({
    loader: async () => {
      return await import("./impl.js");
    },
    parameters: {
      flags: {
        ...parentFlags,
        founded: {
          kind: "parsed",
          parse: String,
          brief: "Year or date the family was founded",
          optional: true,
        },
        dissolved: {
          kind: "parsed",
          parse: String,
          brief: "Year or date the family was dissolved",
          optional: true,
        },
        seat: {
          kind: "parsed",
          parse: String,
          brief: "The family seat (primary location)",
          optional: true,
        },
        motto: {
          kind: "parsed",
          parse: String,
          brief: "The family motto",
          optional: true,
        },
        sigil: {
          kind: "parsed",
          parse: String,
          brief: "Description of the family sigil",
          optional: true,
        },
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: String,
            brief: "Name of the family to create",
          },
        ],
      },
    },
    docs: {
      brief: "Create a new family",
    },
  });
