import {
	buildInstallCommand,
	buildUninstallCommand,
} from "@stricli/auto-complete";
import { buildApplication, buildRouteMap } from "@stricli/core";
import * as packageJson from "../package.json" with { type: "json" };
import { calendarCommandRoutes } from "./commands/calendar/command.js";
import { ddbCommandRoutes } from "./commands/ddb/command.js";
import { kingraphCommandRoutes } from "./commands/kingraph/command.js";
import { migrateCommand } from "./commands/migrate/command.js";
import { newCommandRoutes } from "./commands/new/commands.js";
import { scanStubCommand } from "./commands/scan/command.js";
import { transcribeCommand } from "./commands/transcribe/command.js";
import { ttsCommandRoutes } from "./commands/tts/command.js";
import { validateCommand } from "./commands/validate/command.js";

const { name, version, description } = packageJson as any;

const routes = buildRouteMap({
	routes: {
		new: newCommandRoutes,
		migrate: migrateCommand,
		scan: scanStubCommand,
		transcribe: transcribeCommand,
		tts: ttsCommandRoutes,
		calendar: calendarCommandRoutes,
		kingraph: kingraphCommandRoutes,
		ddb: ddbCommandRoutes,
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
