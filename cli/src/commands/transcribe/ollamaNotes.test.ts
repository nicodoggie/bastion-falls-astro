import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runOllamaHierarchicalNotes, splitTextByLines } from "./ollamaNotes.js";

test("splits text on line boundaries under the target character budget", () => {
  assert.deepEqual(
    splitTextByLines(["alpha", "beta beta", "gamma", "delta"].join("\n"), 16),
    ["alpha\nbeta beta", "gamma\ndelta"],
  );
});

test("keeps oversized lines as their own chunk", () => {
  assert.deepEqual(splitTextByLines("short\nthis-line-is-too-long\nend", 8), [
    "short",
    "this-line-is-too-long",
    "end",
  ]);
});

test("excludes narrated prior-session recaps throughout Ollama notes summarization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-ollama-recap-"));
  const transcriptPath = join(dir, "corrected_transcript.md");
  const notesPath = join(dir, "notes", "session.mdx");
  const prompts: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { prompt: string };
    prompts.push(body.prompt);
    return new Response(JSON.stringify({ response: "- Current-session event." }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await writeFile(transcriptPath, "Previously in The Vengeful...\nCurrent-session event.\n", "utf8");
    await runOllamaHierarchicalNotes({
      campaign: "the-vengeful",
      sessionDate: "2026-07-11",
      transcriptPath,
      contextExcerpt: "",
      notesPath,
      outDir: dir,
      model: "test-model",
      baseUrl: "http://localhost:11434",
      chunkChars: 10_000,
      sceneGroupSize: 5,
      force: true,
      resume: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(prompts.length, 3);
  assert.match(prompts[0]!, /Treat narrated prior-session recaps as context only/);
  assert.match(prompts[1]!, /Do not reintroduce events identified as prior-session recap/);
  assert.match(prompts[2]!, /excluding narrated prior-session recaps/);
  assert.doesNotMatch(prompts[2]!, /Summary contains the readable campaign recap/);
  assert.match(await readFile(notesPath, "utf8"), /Current-session event/);
});

