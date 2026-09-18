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
	pathBase?: string;
	audioFile: string;
	out?: string;
}): {
	audioPath: string;
	outDir: string;
	channelMapPath: string;
} {
	const pathBase = options.pathBase ?? options.cwd;
	const audioPath = resolveFromCwd(pathBase, options.audioFile);
	const outDir = resolveFromCwd(
		pathBase,
		options.out ?? join(".bf-transcripts", slugifyAudioPath(audioPath)),
	);
	return {
		audioPath,
		outDir,
		channelMapPath: join(outDir, "channel-map.yml"),
	};
}

export function resolveContextRoot(pathBase: string, contextRoot: string | undefined, defaultRoot: string): string {
	return contextRoot === undefined ? defaultRoot : resolveFromCwd(pathBase, contextRoot);
}
