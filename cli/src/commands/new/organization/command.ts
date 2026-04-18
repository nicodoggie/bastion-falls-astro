import { buildCommand, type FlagParametersForType } from "@stricli/core";
import type { NewCommandFlags } from "../commands.js";

export interface NewOrganizationCommandFlags extends NewCommandFlags {
  type?: string;
  founded?: string;
  dissolved?: string;
  headquarters?: string;
  members?: string[];
}

const csvList = (value: string) =>
  value.split(",").map((s) => s.trim());

export const organizationCommandBuilder = (
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
          brief: "Organization type (e.g. military, guild, political)",
          optional: true,
        },
        founded: {
          kind: "parsed",
          parse: String,
          brief: "Founding date or era",
          optional: true,
        },
        dissolved: {
          kind: "parsed",
          parse: String,
          brief: "Dissolution date or era",
          optional: true,
        },
        headquarters: {
          kind: "parsed",
          parse: String,
          brief: "Headquarters location",
          optional: true,
        },
        members: {
          kind: "parsed",
          parse: csvList,
          brief: "Comma-separated list of member names",
          optional: true,
        },
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: String,
            brief: "Name of the organization to create",
          },
        ],
      },
    },
    docs: {
      brief: "Create a new organization",
    },
  });
