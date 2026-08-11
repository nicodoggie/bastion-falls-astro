import { z } from "zod";

const localTargetSchema = z
  .object({
    provider: z.enum(["nodejs-whisper", "faster-whisper"]),
    model: z.string().trim().min(1),
  })
  .strict();

const openAiTargetSchema = z
  .object({
    provider: z.literal("openai-compatible"),
    baseUrl: z.url(),
    model: z.string().trim().min(1),
    apiKeyEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
    timeoutSeconds: z.number().int().positive().default(900),
    retries: z.number().int().min(0).max(10).default(2),
  })
  .strict();

const profileSchema = z
  .object({
    layout: z.enum(["stereo", "hybrid"]),
    target: z.string().trim().min(1),
  })
  .strict();

export const transcriptionTargetSchema = z.discriminatedUnion("provider", [
  localTargetSchema,
  openAiTargetSchema,
]);

export const transcriptionSettingsSchema = z.object({
  defaultProfile: z.string().trim().min(1).optional(),
  profiles: z.record(z.string(), profileSchema).default({}),
  targets: z
    .record(z.string(), transcriptionTargetSchema)
    .default({}),
});

export type LocalTranscriptionTarget = z.infer<typeof localTargetSchema>;
export type OpenAiTranscriptionTarget = z.infer<typeof openAiTargetSchema>;
export type TranscriptionTarget = z.infer<typeof transcriptionTargetSchema>;
export type TranscriptionProfile = z.infer<typeof profileSchema>;
export type TranscriptionSettings = z.infer<typeof transcriptionSettingsSchema>;

export type ResolvedTranscriptionProfile = {
  name: string;
  layout: "stereo" | "hybrid";
  target:
    | (LocalTranscriptionTarget & { name: string })
    | (OpenAiTranscriptionTarget & { name: string });
};

const resolvedTranscriptionTargetSchema = z.discriminatedUnion("provider", [
  localTargetSchema.extend({ name: z.string().trim().min(1) }),
  openAiTargetSchema.extend({ name: z.string().trim().min(1) }),
]);

export function assertResolvedTranscriptionTarget(
  value: unknown,
): asserts value is ResolvedTranscriptionProfile["target"] {
  const result = resolvedTranscriptionTargetSchema.safeParse(value);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")).filter(Boolean))];
    throw new Error(`Invalid resolved transcription target${fields.length > 0 ? `: ${fields.join(", ")}` : ""}`);
  }
}

const legacyTarget = {
  name: "legacy-local",
  provider: "nodejs-whisper" as const,
  model: "large-v3-turbo",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveTranscriptionProfile(
  raw: unknown,
  overrideName: string | undefined,
): ResolvedTranscriptionProfile {
  const source = isRecord(raw) ? raw : {};
  const settings = transcriptionSettingsSchema.parse({
    defaultProfile: source["defaultProfile"],
    profiles: source["profiles"],
    targets: source["targets"],
  });
  const profileName = overrideName ?? settings.defaultProfile;

  if (profileName === undefined) {
    const provider = source["backend"];
    const model = source["whisper-model"];
    const legacyProvider =
      provider === "nodejs-whisper" || provider === "faster-whisper"
        ? provider
        : legacyTarget.provider;
    return {
      name: "legacy-local",
      layout: "stereo",
      target: {
        name: "legacy-local",
        provider: legacyProvider,
        model:
          typeof model === "string" && model.trim().length > 0
            ? model
            : legacyTarget.model,
      },
    };
  }

  const profile = settings.profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown transcription profile: ${profileName}`);
  }
  const target = settings.targets[profile.target];
  if (!target) {
    throw new Error(
      `Transcription profile ${profileName} references unknown target ${profile.target}`,
    );
  }

  return {
    name: profileName,
    layout: profile.layout,
    target: { name: profile.target, ...target },
  };
}
