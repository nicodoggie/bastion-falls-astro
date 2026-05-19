import type { ChunkBoundaryReason, PlannedChunk, SilenceInterval } from "./types.js";

export interface PlanChunksOptions {
  durationSeconds: number;
  chunkSeconds: number;
  boundarySearchSeconds: number;
  boundaryMaxSearchSeconds: number;
  overlapSeconds: number;
  silences: SilenceInterval[];
}

interface Boundary {
  time: number;
  reason: ChunkBoundaryReason;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function midpoint(interval: SilenceInterval): number {
  return (interval.start + interval.end) / 2;
}

function nearestSilence(target: number, searchSeconds: number, silences: SilenceInterval[]): SilenceInterval | undefined {
  const candidates = silences
    .map((silence) => ({ silence, distance: Math.abs(midpoint(silence) - target) }))
    .filter(({ distance }) => distance <= searchSeconds)
    .sort((a, b) => a.distance - b.distance);

  return candidates[0]?.silence;
}

function chooseBoundary(target: number, options: PlanChunksOptions): Boundary {
  const nearby = nearestSilence(target, options.boundarySearchSeconds, options.silences);
  if (nearby) {
    return { time: roundSeconds(midpoint(nearby)), reason: "nearby-silence" };
  }

  const widened = nearestSilence(target, options.boundaryMaxSearchSeconds, options.silences);
  if (widened) {
    return { time: roundSeconds(midpoint(widened)), reason: "widened-silence" };
  }

  return { time: roundSeconds(target), reason: "exact-target" };
}

export function planChunks(options: PlanChunksOptions): PlannedChunk[] {
  if (options.durationSeconds <= 0) {
    return [];
  }

  const boundaries: Boundary[] = [{ time: 0, reason: "exact-target" }];
  let target = options.chunkSeconds;
  while (target < options.durationSeconds) {
    const boundary = chooseBoundary(target, options);
    const previous = boundaries[boundaries.length - 1];
    if (!previous || boundary.time <= previous.time) {
      boundary.time = roundSeconds(Math.min(target, options.durationSeconds));
      boundary.reason = "exact-target";
    }
    boundaries.push(boundary);
    target = boundary.time + options.chunkSeconds;
  }
  boundaries.push({ time: roundSeconds(options.durationSeconds), reason: "duration-end" });

  const chunks: PlannedChunk[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startBoundary = boundaries[index];
    const endBoundary = boundaries[index + 1];
    if (!startBoundary || !endBoundary || endBoundary.time <= startBoundary.time) {
      continue;
    }
    chunks.push({
      index,
      start: startBoundary.time,
      end: endBoundary.time,
      overlapStart: roundSeconds(Math.max(0, startBoundary.time - options.overlapSeconds)),
      overlapEnd: roundSeconds(Math.min(options.durationSeconds, endBoundary.time + options.overlapSeconds)),
      endReason: endBoundary.reason,
    });
  }

  return chunks;
}

