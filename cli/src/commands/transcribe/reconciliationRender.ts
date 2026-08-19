import type { CanonicalReconciliation, ReconciliationBlock } from "./reconciliation.js";

function timestamp(seconds: number): string {
  const total = Math.floor(seconds);
  return [
    Math.floor(total / 3600),
    Math.floor((total % 3600) / 60),
    total % 60,
  ].map((part) => String(part).padStart(2, "0")).join(":");
}

function line(block: ReconciliationBlock, text: string, privateLabels: boolean): string {
  const labels = [`[${timestamp(block.start)} - ${timestamp(block.end)}]`];
  if (privateLabels) {
    if (block.channel) labels.push(`[channel:${block.channel}]`);
    if (block.physicalSpeaker) labels.push(`[speaker:${block.physicalSpeaker}]`);
    if (block.characterCandidate) {
      labels.push(`[character:${block.characterCandidate} - ${block.characterConfidence}]`);
    }
    labels.push(
      `[kind:${block.kind}]`,
      `[block:${block.id}]`,
      `[source:${block.sourceEventIds.join(",")}]`,
    );
  }
  return `${labels.join(" ")} ${text.trim()}`;
}

function orderedChunks(
  chunks: readonly CanonicalReconciliation[],
): CanonicalReconciliation[] {
  return [...chunks].sort(
    (left, right) =>
      left.chunk.start - right.chunk.start ||
      left.chunk.end - right.chunk.end ||
      left.chunk.id.localeCompare(right.chunk.id),
  );
}

function orderedBlocks(blocks: readonly ReconciliationBlock[]): ReconciliationBlock[] {
  return [...blocks].sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
}

function chunksBlocks(
  chunks: readonly CanonicalReconciliation[],
): ReconciliationBlock[] {
  return orderedChunks(chunks).flatMap((chunk) => orderedBlocks(chunk.blocks));
}

function finish(lines: string[]): string {
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

export function renderPrivateReconciliation(
  chunks: readonly CanonicalReconciliation[],
): string {
  return finish(chunksBlocks(chunks).map((block) => line(block, block.text, true)));
}

export function renderSummaryReconciliation(
  chunks: readonly CanonicalReconciliation[],
): string {
  for (const chunk of orderedChunks(chunks)) {
    if (
      chunk.summarySafety.status === "pending" ||
      chunk.blocks.some((block) => block.summarySafeText.trim().length === 0)
    ) {
      throw new Error(
        `Cannot render summary reconciliation: summary safety pending for ${chunk.chunk.id}`,
      );
    }
  }

  const lines: string[] = [];
  for (const chunk of orderedChunks(chunks)) {
    if (chunk.suspicionFlags.length || chunk.reviewNotes.length) {
      lines.push(
        `[chunk:${chunk.chunk.id}] [review:${[
          ...chunk.suspicionFlags,
          ...chunk.reviewNotes,
        ].join("; ")}]`,
      );
    }
    lines.push(
      ...orderedBlocks(chunk.blocks).map((block) =>
        line(block, block.summarySafeText, true)),
    );
  }
  return finish(lines);
}

export function renderReconciliationReviewQueue(
  chunks: readonly CanonicalReconciliation[],
): string {
  const lines: string[] = ["# Reconciliation Review Queue", ""];
  for (const chunk of orderedChunks(chunks)) {
    const chunkReasons = [...chunk.suspicionFlags, ...chunk.reviewNotes];
    if (chunkReasons.length) {
      lines.push(
        `## ${chunk.chunk.id} [${timestamp(chunk.chunk.start)} - ${timestamp(chunk.chunk.end)}]`,
        `Reasons: ${chunkReasons.join("; ")}`,
        "",
      );
    }
    for (const block of orderedBlocks(chunk.blocks)) {
      const attributionConcern =
        block.characterConfidence === "probable" ||
        block.characterConfidence === "unknown";
      if (block.reviewFlags.length || attributionConcern) {
        const candidate = block.characterCandidate ?? "unknown";
        const reason = block.reviewFlags.length
          ? block.reviewFlags.join(", ")
          : "attribution concern";
        lines.push(
          `- ${block.id} [${timestamp(block.start)} - ${timestamp(block.end)}]: ${reason} | candidate: ${candidate} | confidence: ${block.characterConfidence} | evidence: ${block.sourceEventIds.join(", ")}`,
        );
      }
    }
    for (const correction of chunk.materialCorrections) {
      lines.push(
        `- correction ${correction.sourceEventId}: ${correction.sourceForm} -> ${correction.replacement} | ${correction.evidence.join("; ")}`,
      );
    }
    for (const omission of chunk.omissions) {
      lines.push(
        `- omission ${omission.sourceEventId} [${timestamp(omission.start)} - ${timestamp(omission.end)}]: ${omission.reason}`,
      );
    }
  }
  if (lines.length === 2) lines.push("None.");
  return finish(lines);
}

function publicLabel(block: ReconciliationBlock): string {
  if (block.kind === "narration") return "[GM]";
  if (block.characterConfidence === "confirmed" && block.characterCandidate) {
    return `[${block.characterCandidate}]`;
  }
  if (block.characterConfidence === "probable" && block.characterCandidate) {
    return `[${block.characterCandidate}? - probable]`;
  }
  return "[Player / character unknown]";
}

function assertPublicText(text: string): void {
  if (/\[(?:speaker|channel):[^\]]+\]/iu.test(text)) {
    throw new Error(
      "Cannot render public reconciliation: private structural marker in readable text",
    );
  }
}

function assertPublicCharacterLabel(candidate: string | undefined): void {
  if (candidate === undefined) return;
  assertPublicText(candidate);
  if (/[\[\]\r\n]/u.test(candidate)) {
    throw new Error(
      "Cannot render public reconciliation: unsafe private structural marker in character label",
    );
  }
}

function assertCharacterIsNotPhysicalIdentity(block: ReconciliationBlock): void {
  if (!block.characterCandidate || !block.physicalSpeaker) return;
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().toLocaleLowerCase();
  if (normalize(block.characterCandidate) === normalize(block.physicalSpeaker)) {
    throw new Error(
      "Cannot render public reconciliation: character label matches a private physical identity",
    );
  }
}

export function renderPublicReconciliation(
  chunks: readonly CanonicalReconciliation[],
): string {
  const lines = chunksBlocks(chunks).map((block) => {
    assertPublicText(block.text);
    assertPublicCharacterLabel(block.characterCandidate);
    assertCharacterIsNotPhysicalIdentity(block);
    return `[${timestamp(block.start)} - ${timestamp(block.end)}] ${publicLabel(block)} ${block.text.trim()}`;
  });
  lines.push(
    "",
    "Confidence legend: confirmed labels are direct evidence; probable labels are reasoned but uncertain; unknown labels indicate insufficient attribution evidence.",
  );
  return finish(lines);
}
