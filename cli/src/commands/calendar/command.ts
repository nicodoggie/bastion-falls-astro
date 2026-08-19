import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";

const resolveCommand = buildCommand({
	loader: async () => await import("./resolve.js"),
	parameters: {
		flags: {
			"timeout-ms": {
				kind: "parsed",
				parse: numberParser,
				brief: "Live fetch timeout in milliseconds",
				optional: true,
			},
			retries: {
				kind: "parsed",
				parse: numberParser,
				brief: "Number of live fetch retries",
				optional: true,
			},
			offline: {
				kind: "boolean",
				brief: "Use the committed fallback without fetching",
				optional: true,
			},
		},
	},
	docs: { brief: "Resolve the current calendar state for Astro" },
});

const auditAgesCommand = buildCommand({
	loader: async () => await import("./audit.js"),
	parameters: {
		flags: {
			json: {
				kind: "boolean",
				brief: "Write machine-readable JSON",
				optional: true,
			},
		},
	},
	docs: { brief: "Audit character ages without modifying content" },
});

const syncCommand = buildCommand({
	loader: async () => await import("./sync.js"),
	parameters: {
		flags: {
			"timeout-ms": {
				kind: "parsed",
				parse: numberParser,
				brief: "Live fetch timeout in milliseconds",
				optional: true,
			},
			retries: {
				kind: "parsed",
				parse: numberParser,
				brief: "Number of live fetch retries",
				optional: true,
			},
			"refresh-metadata": {
				kind: "boolean",
				brief: "Rewrite unchanged state to refresh retrieval metadata",
				optional: true,
			},
		},
	},
	docs: { brief: "Fetch and synchronize the tracked calendar state" },
});

export const calendarCommandRoutes = buildRouteMap({
	routes: {
		resolve: resolveCommand,
		"audit-ages": auditAgesCommand,
		sync: syncCommand,
	},
	docs: { brief: "Bastion calendar state operations" },
});
