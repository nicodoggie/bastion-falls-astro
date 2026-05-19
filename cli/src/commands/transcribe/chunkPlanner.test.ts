import assert from "node:assert/strict";
import { test } from "node:test";

import { planChunks } from "./chunkPlanner.js";

test("chooses nearby silence midpoint for chunk boundaries", () => {
  const chunks = planChunks({
    durationSeconds: 1_300,
    chunkSeconds: 600,
    boundarySearchSeconds: 10,
    boundaryMaxSearchSeconds: 30,
    overlapSeconds: 5,
    silences: [{ start: 595, end: 597, duration: 2 }],
  });

  assert.equal(chunks[0]?.end, 596);
  assert.equal(chunks[0]?.endReason, "nearby-silence");
  assert.equal(chunks[0]?.overlapEnd, 601);
  assert.equal(chunks[1]?.start, 596);
  assert.equal(chunks[1]?.overlapStart, 591);
});

test("widens the silence search before falling back to exact target", () => {
  const chunks = planChunks({
    durationSeconds: 1_250,
    chunkSeconds: 600,
    boundarySearchSeconds: 10,
    boundaryMaxSearchSeconds: 30,
    overlapSeconds: 5,
    silences: [{ start: 624, end: 626, duration: 2 }],
  });

  assert.equal(chunks[0]?.end, 625);
  assert.equal(chunks[0]?.endReason, "widened-silence");
});

test("falls back to exact target when no nearby silence exists", () => {
  const chunks = planChunks({
    durationSeconds: 1_250,
    chunkSeconds: 600,
    boundarySearchSeconds: 10,
    boundaryMaxSearchSeconds: 30,
    overlapSeconds: 5,
    silences: [],
  });

  assert.equal(chunks[0]?.end, 600);
  assert.equal(chunks[0]?.endReason, "exact-target");
});

test("keeps final chunk and overlap bounds inside the source duration", () => {
  const chunks = planChunks({
    durationSeconds: 610,
    chunkSeconds: 600,
    boundarySearchSeconds: 10,
    boundaryMaxSearchSeconds: 30,
    overlapSeconds: 20,
    silences: [],
  });

  assert.deepEqual(chunks.at(-1), {
    index: 1,
    start: 600,
    end: 610,
    overlapStart: 580,
    overlapEnd: 610,
    endReason: "duration-end",
  });
});
