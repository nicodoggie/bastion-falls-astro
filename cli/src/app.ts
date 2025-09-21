import { buildApplication, buildRouteMap } from "@stricli/core";
import { buildInstallCommand, buildUninstallCommand } from "@stricli/auto-complete";
import * as packageJson from "../package.json" assert { type: "json" };

import { newCommandRoutes } from "./commands/new/commands.js";
import { scanStubCommand } from "./commands/scan/command.js";
import { migrateCommand } from "./commands/migrate/command.js";
import { validateCommand } from "./commands/validate/command.js";

const { name, version, description } = packageJson as any;

const routes = buildRouteMap({
  routes: {
    new: newCommandRoutes,
    migrate: migrateCommand,
    scan: scanStubCommand,
    validate: validateCommand,
    install: buildInstallCommand("bfcli", { bash: "__cli_bash_complete" }),
    uninstall: buildUninstallCommand("bfcli", { bash: true }),
  },
  docs: {
    brief: description,
    hideRoute: {
      install: true,
      uninstall: true,
    },
  },
});

export const app = buildApplication(routes, {
  name,
  versionInfo: {
    currentVersion: version,
  },
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(reason);
  console.error(promise);
});

process.on("uncaughtException", (error) => {
  console.error(error);
});
