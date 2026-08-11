import {
	buildCommand,
	buildRouteMap,
	type FlagParametersForType,
} from "@stricli/core";

import type { LocalContext } from "@/context.js";
import type { ChannelsInitFlags } from "./impl.js";

const flags: FlagParametersForType<ChannelsInitFlags, LocalContext> = {
	campaign: {
		kind: "parsed",
		parse: String,
		brief: "Campaign slug, e.g. the-vengeful",
	},
	"session-date": {
		kind: "parsed",
		parse: String,
		brief: "Session date for the transcript session, YYYY-MM-DD",
	},
	out: {
		kind: "parsed",
		parse: String,
		brief: "Output directory for generated transcript artifacts",
		optional: true,
	},
	force: {
		kind: "boolean",
		brief: "Overwrite an existing channel map",
		optional: true,
	},
};

export const channelsInitCommand = buildCommand({
	loader: async () => import("./impl.js"),
	parameters: {
		flags,
		positional: {
			kind: "tuple",
			parameters: [
				{
					parse: String,
					brief: "Audio file to probe",
				},
			],
		},
	},
	docs: {
		brief: "Scaffold a versioned channel-to-speaker map",
	},
});

export const channelsCommand = buildRouteMap({
	routes: {
		init: channelsInitCommand,
	},
	docs: {
		brief: "Inspect and describe transcript audio channels",
	},
});
