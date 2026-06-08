import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";

const importCharacterCommand = buildCommand({
  loader: async () => await import("./impl.js"),
  parameters: {
    flags: {
      out: {
        kind: "parsed",
        parse: String,
        brief: "Output JSON file path. Defaults to characters/ddb-character-<id>.json",
        optional: true,
      },
      force: {
        kind: "boolean",
        brief: "Overwrite the output file if it already exists",
        optional: true,
      },
      port: {
        kind: "parsed",
        parse: numberParser,
        brief: "Chrome DevTools port to use",
        optional: true,
      },
      chrome: {
        kind: "parsed",
        parse: String,
        brief: "Chrome executable path. Defaults to DDB_CHROME_PATH or platform default",
        optional: true,
      },
      profile: {
        kind: "parsed",
        parse: String,
        brief: "Chrome user-data-dir for the auth session",
        optional: true,
      },
      useExistingChrome: {
        kind: "boolean",
        brief: "Use an already-running Chrome DevTools session instead of launching Chrome",
        optional: true,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "D&D Beyond character URL, ddb.ac URL, or numeric character ID",
        },
      ],
    },
  },
  docs: {
    brief: "Import raw D&D Beyond character JSON",
  },
});

const importCampaignCommand = buildCommand({
  loader: async () => await import("./campaignImpl.js"),
  parameters: {
    flags: {
      out: {
        kind: "parsed",
        parse: String,
        brief: "Output JSON file path. Defaults to characters/ddb-campaign-<id>.json",
        optional: true,
      },
      force: {
        kind: "boolean",
        brief: "Overwrite the output file if it already exists",
        optional: true,
      },
      port: {
        kind: "parsed",
        parse: numberParser,
        brief: "Chrome DevTools port to use",
        optional: true,
      },
      chrome: {
        kind: "parsed",
        parse: String,
        brief: "Chrome executable path. Defaults to DDB_CHROME_PATH or platform default",
        optional: true,
      },
      profile: {
        kind: "parsed",
        parse: String,
        brief: "Chrome user-data-dir for the auth session",
        optional: true,
      },
      useExistingChrome: {
        kind: "boolean",
        brief: "Use an already-running Chrome DevTools session instead of launching Chrome",
        optional: true,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "D&D Beyond campaign URL or numeric campaign ID",
        },
      ],
    },
  },
  docs: {
    brief: "Import raw D&D Beyond campaign roster JSON",
  },
});

export const ddbCommandRoutes = buildRouteMap({
  routes: {
    "import-cha": importCharacterCommand,
    "import-character": importCharacterCommand,
    "import-characters": importCharacterCommand,
    "import-campaign": importCampaignCommand,
    "import-campaign-roster": importCampaignCommand,
    "import-roster": importCampaignCommand,
  },
  docs: {
    brief: "D&D Beyond import utilities",
  },
});
