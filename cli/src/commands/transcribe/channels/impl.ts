import type { LocalContext } from "@/context.js";
import { buildChannelMapScaffold, writeChannelMap } from "../channelMap.js";
import { resolveTranscribeSessionPaths } from "../sessionPaths.js";

export interface ChannelsInitFlags {
	campaign: string;
	"session-date": string;
	out?: string;
	force?: boolean;
}

export interface ChannelProbeResult {
	channels: number;
}

export type ChannelProbe = (path: string) => Promise<ChannelProbeResult>;

function assertSessionDate(value: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error("--session-date must use YYYY-MM-DD");
	}
}

export async function initializeChannelMap(
	options: {
		cwd: string;
		audioFile: string;
		out?: string;
		force: boolean;
	},
	probe: ChannelProbe,
): Promise<{ path: string; channelCount: number }> {
	const paths = resolveTranscribeSessionPaths(options);
	const result = await probe(paths.audioPath);
	const channelMap = buildChannelMapScaffold({
		source: paths.audioPath,
		channelCount: result.channels,
	});
	await writeChannelMap({
		path: paths.channelMapPath,
		channelMap,
		force: options.force,
	});
	return { path: paths.channelMapPath, channelCount: result.channels };
}

const task3Probe: ChannelProbe = async () => {
	throw new Error(
		"Audio channel probing is not bound yet; Task 3 will connect channels init to FFprobe.",
	);
};

export default async function channelsInit(
	this: LocalContext,
	flags: ChannelsInitFlags,
	audioFile: string,
): Promise<void> {
	assertSessionDate(flags["session-date"]);
	const result = await initializeChannelMap(
		{
			cwd: this.currentPath,
			audioFile,
			out: flags.out,
			force: Boolean(flags.force),
		},
		task3Probe,
	);
	this.process.stdout.write(
		`Wrote ${result.path} for ${result.channelCount} detected channels\n`,
	);
}
