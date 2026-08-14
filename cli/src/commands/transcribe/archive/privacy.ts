import yaml from "js-yaml";
import { z } from "zod";

export const PRIVATE_REDACTIONS_FILENAME = "redactions.yaml";
export const PUBLIC_PRIVACY_RECEIPT_FILENAME = "privacy-review.yaml";

const timestampSchema = z.string().regex(/^\d{2}:[0-5]\d:[0-5]\d\.\d{3}$/).refine((value) => {
  const [, hours, minutes, seconds, milliseconds] = value.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/)!;
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000;
  return Number.isFinite(total) && total >= 0 && Number(hours) >= 0 && Number(minutes) < 60 && Number(seconds) < 60 && Number(milliseconds) >= 0;
}, "invalid timestamp");

const intervalFields = {
  start: timestampSchema,
  end: timestampSchema,
};

const audioRuleSchema = z.object({
  id: z.string().min(1),
  ...intervalFields,
  channels: z.literal("all"),
  reason: z.literal("physical-speaker-identity"),
  fadeMilliseconds: z.number().int().min(0).max(1000).safe().default(20),
}).strict().superRefine((rule, ctx) => {
  if (!(timestampToSeconds(rule.end) > timestampToSeconds(rule.start))) {
    ctx.addIssue({ code: "custom", path: ["end"], message: "end must be after start" });
  }
});

const transcriptRuleSchema = z.object({
  id: z.string().min(1),
  ...intervalFields,
  replacement: z.literal("[microphone identity check redacted]"),
}).strict().superRefine((rule, ctx) => {
  if (!(timestampToSeconds(rule.end) > timestampToSeconds(rule.start))) {
    ctx.addIssue({ code: "custom", path: ["end"], message: "end must be after start" });
  }
});

function uniqueIds<T extends { id: string }>(rules: T[], path: string[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    if (seen.has(rule.id)) ctx.addIssue({ code: "custom", path: [...path, index, "id"], message: "duplicate rule id" });
    seen.add(rule.id);
  });
}

export const privateRedactionsSchema = z.object({
  version: z.literal(1),
  reviewed: z.literal(true),
  audio: z.array(audioRuleSchema),
  transcripts: z.array(transcriptRuleSchema),
  speakerLabels: z.enum(["preserve", "neutralize"]),
}).strict().superRefine((manifest, ctx) => {
  uniqueIds(manifest.audio, ["audio"], ctx);
  uniqueIds(manifest.transcripts, ["transcripts"], ctx);
});

export const publicPrivacyReceiptSchema = z.object({
  version: z.literal(1),
  reviewed: z.literal(true),
  policy: z.literal("transcript-archive-privacy-v1"),
  audioRedactionsApplied: z.number().int().nonnegative().safe(),
  transcriptRedactionsApplied: z.number().int().nonnegative().safe(),
  speakerLabels: z.enum(["preserved", "neutralized"]),
}).strict();

export type PrivateRedactions = z.infer<typeof privateRedactionsSchema>;
export type PublicPrivacyReceipt = z.infer<typeof publicPrivacyReceiptSchema>;

export function timestampToSeconds(value: string): number {
  const match = /^(\d{2}):([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  if (!match) throw new Error("invalid timestamp; expected HH:MM:SS.mmm");
  const result = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  if (!Number.isFinite(result) || result < 0) throw new Error("timestamp must be finite and nonnegative");
  return result;
}

function loadStrictYaml(text: string): unknown {
  if (typeof text !== "string" || text.trim() === "") throw new Error("YAML document must be non-empty");
  // Archives accept only ordinary CORE_SCHEMA scalars and collections. Do not permit
  // aliases or application-defined tags, even if js-yaml could resolve them.
  if (/(^|[\s,[{])[*&][A-Za-z_][\w-]*|(^|\s)!\S/.test(text)) {
    throw new Error("YAML aliases and custom tags are not permitted");
  }
  return yaml.load(text, { schema: yaml.CORE_SCHEMA, json: false });
}

export function parsePrivateRedactionsYaml(text: string): PrivateRedactions {
  return privateRedactionsSchema.parse(loadStrictYaml(text));
}

export function parsePublicPrivacyReceiptYaml(text: string): PublicPrivacyReceipt {
  return publicPrivacyReceiptSchema.parse(loadStrictYaml(text));
}

export function serializePublicPrivacyReceipt(receipt: PublicPrivacyReceipt): string {
  const validated = publicPrivacyReceiptSchema.parse(receipt);
  return yaml.dump(validated, { schema: yaml.CORE_SCHEMA, noRefs: true, lineWidth: -1 });
}
