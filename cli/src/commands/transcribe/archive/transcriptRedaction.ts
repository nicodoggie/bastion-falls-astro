import type { PrivateRedactions } from "./privacy.js";
import { timestampToSeconds } from "./privacy.js";

export interface TranscriptRedactionResult {
  text: string;
  appliedRuleIds: string[];
  redactionCount: number;
  neutralizedSpeakerLabelCount: number;
}

interface TimestampedLine {
  start: number;
  end: number;
}

const TIMESTAMPED_LINE = /^\[(\d{2}:\d{2}:\d{2}(?:\.\d{3})?) - (\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]/;
const SPEAKER_LABEL = /\s*\[speaker:([^\]]+)\]/g;
const CHANNEL_LABEL = /\[channel:(left|right)\]/;
const PUBLIC_SAFE_SPEAKERS = new Set(["left", "right"]);

function parseTranscriptTimestamp(value: string): number {
  return timestampToSeconds(value.includes(".") ? value : `${value}.000`);
}

function parseTimestampedLine(line: string): TimestampedLine | undefined {
  const match = TIMESTAMPED_LINE.exec(line);
  if (!match) return undefined;
  return {
    start: parseTranscriptTimestamp(match[1]!),
    end: parseTranscriptTimestamp(match[2]!),
  };
}

function overlaps(event: TimestampedLine, start: number, end: number): boolean {
  return event.start < end && event.end > start;
}

function neutralizeSpeakerLabels(line: string): { line: string; count: number } {
  const channel = CHANNEL_LABEL.exec(line)?.[1];
  let count = 0;
  const transformed = line.replace(SPEAKER_LABEL, (full, rawLabel: string) => {
    const label = rawLabel.trim();
    if (PUBLIC_SAFE_SPEAKERS.has(label)) return full;
    count += 1;
    return channel ? ` [speaker:${channel}]` : "";
  });
  return { line: transformed, count };
}

export function findUnsafePublicSpeakerLabels(text: string): Array<{ line: number }> {
  const unsafe: Array<{ line: number }> = [];
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/\[speaker:([^\]]+)\]/g)) {
      if (!PUBLIC_SAFE_SPEAKERS.has(match[1]!.trim())) {
        unsafe.push({ line: index + 1 });
        break;
      }
    }
  });
  return unsafe;
}

export function redactTranscript(text: string, manifest: PrivateRedactions): TranscriptRedactionResult {
  const hadTrailingNewline = text.endsWith("\n");
  let lines = text.split("\n");
  if (hadTrailingNewline) lines.pop();

  const appliedRuleIds: string[] = [];
  for (const rule of manifest.transcripts) {
    const start = timestampToSeconds(rule.start);
    const end = timestampToSeconds(rule.end);
    const matchingIndexes: number[] = [];

    lines.forEach((line, index) => {
      const event = parseTimestampedLine(line);
      if (event && overlaps(event, start, end)) matchingIndexes.push(index);
    });

    if (matchingIndexes.length === 0) {
      throw new Error(`Transcript redaction rule ${rule.id} matched no timestamped event`);
    }

    const first = matchingIndexes[0]!;
    const matched = new Set(matchingIndexes);
    lines = lines.flatMap((line, index) => {
      if (index === first) return [`[${rule.start} - ${rule.end}] ${rule.replacement}`];
      return matched.has(index) ? [] : [line];
    });
    appliedRuleIds.push(rule.id);
  }

  let neutralizedSpeakerLabelCount = 0;
  if (manifest.speakerLabels === "neutralize") {
    lines = lines.map((line) => {
      const result = neutralizeSpeakerLabels(line);
      neutralizedSpeakerLabelCount += result.count;
      return result.line;
    });
    const unsafe = findUnsafePublicSpeakerLabels(lines.join("\n"));
    if (unsafe.length > 0) {
      throw new Error(`Unsafe public speaker label remains at line ${unsafe[0]!.line}`);
    }
  }

  return {
    text: `${lines.join("\n")}${hadTrailingNewline ? "\n" : ""}`,
    appliedRuleIds,
    redactionCount: appliedRuleIds.length,
    neutralizedSpeakerLabelCount,
  };
}
