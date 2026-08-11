import { basename, extname, isAbsolute, join, resolve } from "node:path";

export function slugifyAudioPath(audioPath: string): string {
	const stem = basename(audioPath, extname(audioPath));
	return (
		stem
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "session"
	);
}

export function resolveFromCwd(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

export function resolveTranscribeSessionPaths(options: {
	cwd: string;
	audioFile: string;
	out?: string;
}): {
	audioPath: string;
	outDir: string;
	channelMapPath: string;
} {
	const audioPath = resolveFromCwd(options.cwd, options.audioFile);
	const outDir = resolveFromCwd(
		options.cwd,
		options.out ?? join(".bf-transcripts", slugifyAudioPath(audioPath)),
	);
	return {
		audioPath,
		outDir,
		channelMapPath: join(outDir, "channel-map.yml"),
	};
}
