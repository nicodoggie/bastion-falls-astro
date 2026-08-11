import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

export const expectedCharacterSchema = z
	.object({
		name: z.string().trim().min(1),
		aliases: z.array(z.string().trim().min(1)).default([]),
	})
	.strict();

export const physicalSpeakerSchema = z
	.object({
		name: z.string().trim().min(1),
		role: z.enum(["gm", "player", "guest", "unknown"]),
		expectedCharacters: z.array(expectedCharacterSchema).default([]),
	})
	.strict()
	.superRefine((speaker, context) => {
		const identities = new Map<string, string>();
		for (const [
			characterIndex,
			character,
		] of speaker.expectedCharacters.entries()) {
			const values = [character.name, ...character.aliases];
			for (const [valueIndex, value] of values.entries()) {
				const normalized = value.toLocaleLowerCase();
				const previous = identities.get(normalized);
				if (previous !== undefined) {
					context.addIssue({
						code: "custom",
						message: `Duplicate expected-character name or alias: ${value} (already used by ${previous})`,
						path:
							valueIndex === 0
								? ["expectedCharacters", characterIndex, "name"]
								: [
										"expectedCharacters",
										characterIndex,
										"aliases",
										valueIndex - 1,
									],
					});
				} else {
					identities.set(normalized, character.name);
				}
			}
		}
	});

const channelSchema = z
	.object({
		id: z.string().trim().min(1),
		index: z.number().int().nonnegative(),
		speakers: z.array(physicalSpeakerSchema).default([]),
		notes: z.string().trim().optional(),
	})
	.strict();

type Channel = z.infer<typeof channelSchema>;

function addUniqueChannelAndAliasIssues(
	value: { channels: Channel[] },
	context: z.RefinementCtx,
): void {
	const ids = new Set<string>();
	const indexes = new Set<number>();

	for (const [channelIndex, channel] of value.channels.entries()) {
		if (ids.has(channel.id)) {
			context.addIssue({
				code: "custom",
				message: `Duplicate channel ID: ${channel.id}`,
				path: ["channels", channelIndex, "id"],
			});
		}
		ids.add(channel.id);

		if (indexes.has(channel.index)) {
			context.addIssue({
				code: "custom",
				message: `Duplicate channel index: ${channel.index}`,
				path: ["channels", channelIndex, "index"],
			});
		}
		indexes.add(channel.index);
	}
}

export const channelMapSchema = z
	.object({
		version: z.literal(1),
		source: z.string().trim().min(1),
		channels: z.array(channelSchema).min(1),
	})
	.strict()
	.superRefine(addUniqueChannelAndAliasIssues);

export type ExpectedCharacter = z.infer<typeof expectedCharacterSchema>;
export type PhysicalSpeaker = z.infer<typeof physicalSpeakerSchema>;
export type ChannelMap = z.infer<typeof channelMapSchema>;

export function parseChannelMap(raw: unknown): ChannelMap {
	return channelMapSchema.parse(raw);
}

export async function loadChannelMap(path: string): Promise<ChannelMap> {
	return parseChannelMap(yaml.load(await readFile(path, "utf8")));
}

export function buildChannelMapScaffold(options: {
	source: string;
	channelCount: number;
}): ChannelMap {
	if (!Number.isInteger(options.channelCount) || options.channelCount < 1) {
		throw new RangeError("channelCount must be a positive integer");
	}

	const channels = Array.from({ length: options.channelCount }, (_, index) => ({
		id:
			options.channelCount === 2
				? index === 0
					? "left"
					: "right"
				: `channel-${index}`,
		index,
		speakers: [],
	}));

	return parseChannelMap({
		version: 1,
		source: options.source,
		channels,
	});
}

export async function writeChannelMap(options: {
	path: string;
	channelMap: ChannelMap;
	force: boolean;
}): Promise<void> {
	const parsed = parseChannelMap(options.channelMap);
	await mkdir(dirname(options.path), { recursive: true });
	await writeFile(options.path, yaml.dump(parsed), {
		encoding: "utf8",
		flag: options.force ? "w" : "wx",
	});
}
