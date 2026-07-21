export type ReviewProvider = "hermes" | "off";

export interface ReviewOverrides {
	provider?: ReviewProvider;
	hermesProfile?: string;
	hermesMaxTurns?: number;
}

export interface ResolvedReviewSettings {
	provider: ReviewProvider;
	hermesProfile?: string;
	hermesMaxTurns: number;
}

interface RawReviewConfig {
	provider?: unknown;
	hermes?: unknown;
}

interface RawHermesReviewConfig {
	profile?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReviewProvider(value: string): ReviewProvider {
	if (value === "hermes" || value === "off") {
		return value;
	}
	throw new Error(`Unsupported review provider: ${value}`);
}

export function resolveReviewSettings(
	config: unknown,
	overrides: ReviewOverrides = {},
): ResolvedReviewSettings {
	if (config !== undefined && !isRecord(config)) {
		throw new Error("transcribe.review must be an object");
	}

	const reviewConfig = (config ?? {}) as RawReviewConfig;
	const configuredProvider = reviewConfig.provider;
	if (
		configuredProvider !== undefined &&
		typeof configuredProvider !== "string"
	) {
		throw new Error("transcribe.review.provider must be a string");
	}

	const hermesConfigValue = reviewConfig.hermes;
	if (hermesConfigValue !== undefined && !isRecord(hermesConfigValue)) {
		throw new Error("transcribe.review.hermes must be an object");
	}
	const hermesConfig = (hermesConfigValue ?? {}) as RawHermesReviewConfig;
	const configuredProfile = hermesConfig.profile;
	if (
		configuredProfile !== undefined &&
		typeof configuredProfile !== "string"
	) {
		throw new Error("transcribe.review.hermes.profile must be a string");
	}

	return {
		provider:
			overrides.provider ??
			(configuredProvider === undefined
				? "off"
				: parseReviewProvider(configuredProvider)),
		hermesProfile: overrides.hermesProfile ?? configuredProfile,
		hermesMaxTurns: overrides.hermesMaxTurns ?? 12,
	};
}
