import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadChannelMap, parseChannelMap } from "./channelMap.js";
import { initializeChannelMap } from "./channels/impl.js";

test("parses partial physical-speaker and expected-character mappings", () => {
	const parsed = parseChannelMap({
		version: 1,
		source: "/recordings/session.wav",
		channels: [
			{
				id: "left",
				index: 0,
				speakers: [
					{
						name: "Known GM",
						role: "gm",
						expectedCharacters: [],
					},
				],
			},
			{
				id: "right",
				index: 1,
				speakers: [],
			},
		],
	});

	assert.deepEqual(parsed.channels[0]?.speakers[0]?.expectedCharacters, []);
	assert.deepEqual(parsed.channels[1]?.speakers, []);
});

test("rejects duplicate channel IDs or indexes", () => {
	for (const channels of [
		[
			{ id: "left", index: 0 },
			{ id: "left", index: 1 },
		],
		[
			{ id: "left", index: 0 },
			{ id: "right", index: 0 },
		],
	]) {
		assert.throws(
			() =>
				parseChannelMap({
					version: 1,
					source: "/recordings/session.wav",
					channels,
				}),
			/duplicate channel (?:id|index)/i,
		);
	}
});

test("scaffolds a probed two-channel map that round-trips through YAML", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "bf-channel-map-"));
	try {
		const result = await initializeChannelMap(
			{
				cwd,
				audioFile: "recordings/My Session.wav",
				force: false,
			},
			async () => ({ channels: 2 }),
		);

		assert.deepEqual(result, {
			path: join(cwd, ".bf-transcripts", "my-session", "channel-map.yml"),
			channelCount: 2,
		});
		assert.deepEqual(await loadChannelMap(result.path), {
			version: 1,
			source: join(cwd, "recordings", "My Session.wav"),
			channels: [
				{ id: "left", index: 0, speakers: [] },
				{ id: "right", index: 1, speakers: [] },
			],
		});
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
