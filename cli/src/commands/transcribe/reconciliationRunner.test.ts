import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  access,
  writeFile,
  chmod,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  buildHermesReconciliationArgs,
  buildUnifiedReconciliationPrompt,
  parseHermesReconciliationJson,
  parseStrictReconciliationJson,
  boundedHermes,
  runUnifiedReconciliation,
  writeCanonicalReconciliationAtomic,
  writeReconciliationTextAtomic,
  PendingSummarySafetyError,
  validateReconciliationOutput,
  type ReconciliationChunkJob,
} from "./reconciliationRunner.js";
import { renderPublicReconciliation } from "./reconciliationRender.js";

const source = [{ id: "e1", text: "hello", start: 0, end: 1, confidence: 0.9 }];
const owned = [{ ...source[0]!, sourcePass: "left", alternatives: [] }];
const packet = {
  evidenceVersion: 1 as const,
  promptVersion: "reconciliation.prompt.v1",
  schemaVersion: "reconciliation.v1",
  chunk: { id: "session_000", start: 0, end: 2 },
  ownedEvents: owned,
  context: {
    contextOnly: true as const,
    previousReadableTail: ["context"],
    nextAlignmentHead: [],
  },
  expectedCharacters: [],
  glossary: [],
  correctionRules: [],
  provider: { provider: "hermes", model: "test" },
  evidenceRevision: "r1",
  cacheIdentity: {
    inputHash: "i",
    contextHash: "c",
    sourceHash: "s",
    alignmentHash: "a",
    neighborHash: "n",
    channelMapHash: "m",
    glossaryHash: "g",
    correctionRulesHash: "r",
    evidenceRevision: "r1",
    providerIdentity: "p",
  },
};
const job: ReconciliationChunkJob = {
  packet,
  authoritativeSourceEvents: source,
};
const response = () => ({
  schemaVersion: "reconciliation.v1",
  promptVersion: packet.promptVersion,
  chunk: packet.chunk,
  cacheIdentity: packet.cacheIdentity,
  blocks: [
    {
      id: "b1",
      start: 0,
      end: 1,
      kind: "dialogue",
      text: "Hello.",
      summarySafeText: "Hello.",
      characterConfidence: "unknown",
      attributionBasis: ["none"],
      sourceEventIds: ["e1"],
      reviewFlags: [],
    },
  ],
  omissions: [],
  materialCorrections: [],
  suspicionFlags: [],
  reviewNotes: [],
  summarySafety: { status: "valid", errors: [] },
});

test("prompt marks neighbors context-only and owns only the packet window", () => {
  const prompt = buildUnifiedReconciliationPrompt(job);
  assert.match(prompt, /context-only/iu);
  assert.match(prompt, /session_000/iu);
  assert.match(prompt, /read-only/iu);
  assert.match(prompt, /complete output contract/iu);
  assert.match(prompt, /materialCorrections/iu);
  assert.match(prompt, /characterConfidence.*confirmed.*probable.*unknown/isu);
  assert.match(prompt, /expectedCharacters.*candidate.*not.*proof/iu);
  assert.match(prompt, /channel.*physicalSpeaker.*supplied.*evidence/isu);
  assert.match(prompt, /do not search the repository for schemas/iu);
  assert.match(prompt, /suspicionFlags.*must never.*reviewFlags/iu);
  assert.match(
    prompt,
    /derive.*start.*minimum.*end.*maximum.*sourceEventIds/isu,
  );
  assert.match(prompt, /runner.*recomputes.*start.*end.*authoritative/isu);
  assert.match(
    prompt,
    /attributionBasis.*materialCorrection.*evidence.*reviewNotes.*summarySafety.*errors.*256/isu,
  );
  assert.match(
    prompt,
    /duplicate.*sourceEventIds.*first.*chronological.*block/isu,
  );
  assert.match(prompt, /transcript, not a narrative digest/iu);
  assert.match(
    prompt,
    /channel-only or isolated candidate.*not automatically speech.*unclear review-only block.*short token.*channel.*energy alone/isu,
  );
  assert.match(
    prompt,
    /overlapping stereo\/channel candidates.*competing hypotheses.*intelligibility and corroboration.*stereo is not an automatic winner/isu,
  );
  assert.match(
    prompt,
    /distinct.*sufficiently supported utterance.*ADD.*separate.*retaining the original.*never replace/isu,
  );
  assert.match(
    prompt,
    /weak or unsupported as speech.*unclear review-only.*not as dialogue.*clear “No”/isu,
  );
  assert.match(prompt, /meaningful repetition/iu);
  assert.doesNotMatch(prompt, /emit neighboring events/iu);
});

function behavioralJob(
  events: Array<{
    id: string;
    text: string;
    start: number;
    end: number;
    sourcePass: string;
  }>,
): ReconciliationChunkJob {
  const authoritative = events.map(
    ({ sourcePass: _sourcePass, ...event }) => event,
  );
  const ownedEvents = events.map((event) => ({ ...event, alternatives: [] }));
  return {
    packet: {
      ...packet,
      ownedEvents,
      chunk: {
        ...packet.chunk,
        end: Math.max(...events.map((event) => event.end)),
      },
    },
    authoritativeSourceEvents: authoritative,
  } as ReconciliationChunkJob;
}

function behavioralResponse(
  job: ReconciliationChunkJob,
  blocks: readonly {
    id: string;
    kind: "dialogue" | "unclear";
    text: string;
    sourceEventIds: readonly string[];
    reviewFlags?: readonly string[];
  }[],
) {
  return {
    schemaVersion: job.packet.schemaVersion,
    promptVersion: job.packet.promptVersion,
    chunk: job.packet.chunk,
    cacheIdentity: job.packet.cacheIdentity,
    blocks: blocks.map((block) => ({
      id: block.id,
      start: 0,
      end: 1,
      kind: block.kind,
      text: block.text,
      summarySafeText: block.text,
      characterConfidence: "unknown",
      attributionBasis: ["source-pass corroboration"],
      sourceEventIds: block.sourceEventIds,
      reviewFlags: block.reviewFlags ?? [],
    })),
    omissions: [],
    materialCorrections: [],
    suspicionFlags: [],
    reviewNotes: [],
    summarySafety: { status: "valid", errors: [] },
  };
}

test("bounded evidence selection preserves supported wording, adds supported interruptions, and retains short speech", async () => {
  const cases = [
    {
      name: "stereo-clearer-than-unsupported-alternate",
      job: behavioralJob([
        {
          id: "stereo",
          text: "We leave now.",
          start: 0,
          end: 1,
          sourcePass: "stereo",
        },
        {
          id: "alternate",
          text: "We leave cow.",
          start: 0.1,
          end: 0.9,
          sourcePass: "left",
        },
      ]),
      blocks: [
        {
          id: "clear",
          kind: "dialogue" as const,
          text: "We leave now.",
          sourceEventIds: ["stereo"],
        },
        {
          id: "weak",
          kind: "unclear" as const,
          text: "We leave cow.",
          sourceEventIds: ["alternate"],
          reviewFlags: ["unclear-words"],
        },
      ],
    },
    {
      name: "channel-clearer-than-stereo",
      job: behavioralJob([
        {
          id: "stereo",
          text: "Meet at ten.",
          start: 0,
          end: 1,
          sourcePass: "stereo",
        },
        {
          id: "channel",
          text: "Meet at noon.",
          start: 0.1,
          end: 0.9,
          sourcePass: "right",
        },
      ]),
      blocks: [
        {
          id: "chosen",
          kind: "dialogue" as const,
          text: "Meet at noon.",
          sourceEventIds: ["stereo", "channel"],
        },
      ],
    },
    {
      name: "corroborated-additional-interruption",
      job: behavioralJob([
        {
          id: "original",
          text: "I object.",
          start: 0,
          end: 1,
          sourcePass: "stereo",
        },
        {
          id: "interruption",
          text: "Wait!",
          start: 0.5,
          end: 1.5,
          sourcePass: "right",
        },
      ]),
      blocks: [
        {
          id: "original-block",
          kind: "dialogue" as const,
          text: "I object.",
          sourceEventIds: ["original"],
        },
        {
          id: "added-block",
          kind: "dialogue" as const,
          text: "Wait!",
          sourceEventIds: ["interruption"],
        },
      ],
    },
    {
      name: "genuine-short-no",
      job: behavioralJob([
        { id: "no", text: "No", start: 0, end: 1, sourcePass: "stereo" },
      ]),
      blocks: [
        {
          id: "no-block",
          kind: "dialogue" as const,
          text: "No",
          sourceEventIds: ["no"],
        },
      ],
    },
  ] as const;

  for (const scenario of cases) {
    const root = await mkdtemp(
      join(tmpdir(), `reconciliation-selection-${scenario.name}-`),
    );
    try {
      const result = await runUnifiedReconciliation({
        rootDir: root,
        jobs: [scenario.job],
        invokeReconciliation: async () =>
          JSON.stringify(
            behavioralResponse(scenario.job, [...scenario.blocks]),
          ),
      });
      const chunk = result.chunks[0]!;
      assert.deepEqual(
        chunk.blocks.map((block) => [
          block.kind,
          block.text,
          block.sourceEventIds,
        ]),
        scenario.blocks.map((block) => [
          block.kind,
          block.text,
          block.sourceEventIds,
        ]),
      );
      const privateText = await readFile(
        join(root, "reconciled_transcript.md"),
        "utf8",
      );
      assert.ok(privateText.includes(scenario.blocks[0]!.text));
      const publicText = renderPublicReconciliation([chunk]);
      if (scenario.name === "stereo-clearer-than-unsupported-alternate")
        assert.match(publicText, /Editorial uncertainty.*We leave cow/iu);
      if (scenario.name === "corroborated-additional-interruption")
        assert.match(publicText, /I object[\s\S]*Wait!/u);
      if (scenario.name === "genuine-short-no") assert.match(publicText, /No/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("Hermes args use the repository chat contract", () => {
  const args = buildHermesReconciliationArgs({
    promptPath: "/tmp/reconciliation-request.json",
    profile: "p",
    maxTurns: 7,
  });
  assert.deepEqual(args.slice(0, 13), [
    "hermes",
    "--profile",
    "p",
    "chat",
    "-Q",
    "--source",
    "tool",
    "-t",
    "file",
    "-s",
    "bastion-transcript-evidence-workflows",
    "--max-turns",
    "7",
  ]);
  assert.equal(args.at(-2), "-q");
  assert.match(args.at(-1)!, /\/tmp\/reconciliation-request\.json/u);
});

test("strict JSON parser rejects trailing non-whitespace", () => {
  assert.deepEqual(
    parseStrictReconciliationJson(JSON.stringify(response())),
    response(),
  );
  assert.throws(() =>
    parseStrictReconciliationJson(`${JSON.stringify(response())}\nnot-json`),
  );
  const maxTurns = `\u26a0\ufe0f  Reached maximum iterations (8). Requesting summary...\r\n${JSON.stringify(response())}`;
  assert.throws(() => parseStrictReconciliationJson(maxTurns));
  assert.deepEqual(parseHermesReconciliationJson(maxTurns), response());
  assert.throws(() =>
    parseHermesReconciliationJson(`notice\n${JSON.stringify(response())}`),
  );
});

test("one ordinary call writes canonical JSON, joined derivatives, and diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-runner-"));
  let calls = 0;
  let checkpointSawPublished = false;
  const lifecycle: string[] = [];
  try {
    const result = await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: async () => {
        calls += 1;
        return {
          stdout: JSON.stringify(response()),
          stderr: "warn",
          metadata: { exitCode: 0 },
        };
      },
      checkpoint: async () => {
        await readFile(join(root, "reconciliation/session_000.json"), "utf8");
        checkpointSawPublished = true;
      },
      onChunkProgress: ({ status }) => {
        lifecycle.push(status);
      },
    });
    assert.equal(calls, 1);
    assert.equal(checkpointSawPublished, true);
    assert.equal(result.chunks.length, 1);
    assert.deepEqual(lifecycle, ["started", "completed"]);
    assert.match(
      await readFile(join(root, "reconciled_transcript.md"), "utf8"),
      /Hello/,
    );
    assert.match(
      await readFile(join(root, "summary_transcript.md"), "utf8"),
      /Hello/,
    );
    assert.ok((await readdir(join(root, "diagnostics"))).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a timed-out Hermes chunk retries after cleanup and preserves attempt diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-retry-"));
  const command = join(root, "retry-hermes.mjs");
  const counter = join(root, "attempts.txt");
  const retries: unknown[] = [];
  const lifecycle: string[] = [];
  try {
    await writeFile(
      command,
      `#!/usr/bin/env node\nimport { existsSync, readFileSync, writeFileSync } from "node:fs";\nconst path = ${JSON.stringify(counter)};\nconst count = existsSync(path) ? Number(readFileSync(path, "utf8")) + 1 : 1;\nwriteFileSync(path, String(count));\nif (count === 1) { process.stderr.write("first attempt stalled"); setInterval(() => {}, 1000); }\nelse process.stdout.write(${JSON.stringify(JSON.stringify(response()))});\n`,
    );
    await chmod(command, 0o755);
    const result = await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      hermesCommand: command,
      timeoutMs: 500,
      onRetry: (retry) => {
        retries.push(retry);
      },
      onChunkProgress: ({ status }) => {
        lifecycle.push(status);
      },
    });
    assert.equal(await readFile(counter, "utf8"), "2");
    assert.deepEqual(retries, [
      { chunkId: "session_000", nextAttempt: 2, maxAttempts: 3 },
    ]);
    assert.deepEqual(lifecycle, ["started", "retry", "completed"]);
    assert.deepEqual(result.repairedChunkIds, ["session_000"]);
    assert.equal(result.chunks.length, 1);
    const diagnostics = await Promise.all(
      (await readdir(join(root, "diagnostics"))).map(async (name) =>
        JSON.parse(await readFile(join(root, "diagnostics", name), "utf8")),
      ),
    );
    assert.equal(diagnostics.length, 2);
    assert.ok(
      diagnostics.some(
        (d) =>
          /timed out/.test(d.error) && d.stderr === "first attempt stalled",
      ),
    );
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      hermesCommand: command,
      timeoutMs: 500,
      resume: true,
    });
    assert.equal(await readFile(counter, "utf8"), "2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Hermes timeout retries stop after three attempts without publishing a chunk", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-retry-exhausted-"));
  const command = join(root, "stalled-hermes.mjs");
  const retries: number[] = [];
  try {
    await writeFile(
      command,
      "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
    );
    await chmod(command, 0o755);
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          hermesCommand: command,
          timeoutMs: 100,
          onRetry: ({ nextAttempt }) => {
            retries.push(nextAttempt);
          },
        }),
      /Hermes timed out/,
    );
    assert.deepEqual(retries, [2, 3]);
    const diagnostics = await readdir(join(root, "diagnostics"));
    assert.equal(diagnostics.length, 3);
    for (const name of diagnostics)
      assert.match(
        JSON.parse(await readFile(join(root, "diagnostics", name), "utf8"))
          .error,
        /Hermes timed out/,
      );
    assert.deepEqual(await readdir(join(root, "reconciliation")), []);
    assert.deepEqual(
      (await readdir(root)).filter((name) =>
        name.startsWith(".reconciliation-prompt-"),
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Hermes validation and process failures do not retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-no-retry-"));
  try {
    for (const [name, output, exitCode] of [
      [
        "unknown-event",
        JSON.stringify({
          ...response(),
          blocks: [{ ...response().blocks[0], sourceEventIds: ["unknown"] }],
        }),
        0,
      ],
      ["json", "invalid JSON", 0],
      ["process", "", 1],
    ] as const) {
      const dir = join(root, name);
      const command = join(root, `${name}.mjs`);
      await writeFile(
        command,
        `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(output)}); process.exit(${exitCode});\n`,
      );
      await chmod(command, 0o755);
      await assert.rejects(() =>
        runUnifiedReconciliation({
          rootDir: dir,
          jobs: [job],
          hermesCommand: command,
          timeoutMs: 2_000,
          onRetry: () => {
            assert.fail("must not retry permanent failures");
          },
        }),
      );
      assert.equal((await readdir(join(dir, "diagnostics"))).length, 1);
      assert.deepEqual(await readdir(join(dir, "reconciliation")), []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hard-invalid output is diagnostic-only and never creates canonical JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-invalid-"));
  try {
    await assert.rejects(() =>
      runUnifiedReconciliation({
        rootDir: root,
        jobs: [job],
        invokeReconciliation: async () => ({
          stdout: `${JSON.stringify(response())} trailing`,
          stderr: "raw",
          metadata: { token: "m" },
        }),
      }),
    );
    await assert.rejects(() =>
      access(join(root, "reconciliation", "session_000.json")),
    );
    const diagnostic = await readFile(
      join(root, "diagnostics", (await readdir(join(root, "diagnostics")))[0]!),
      "utf8",
    );
    assert.match(diagnostic, /trailing|strict JSON/iu);
    assert.match(diagnostic, /raw/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cache-identical resume makes zero calls, while stale identity repairs", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-resume-"));
  let calls = 0;
  const lifecycle: string[] = [];
  try {
    const invoke = async () => {
      calls += 1;
      return JSON.stringify(response());
    };
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      resume: true,
      onChunkProgress: ({ status }) => {
        lifecycle.push(status);
      },
    });
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      resume: true,
      onChunkProgress: ({ status }) => {
        lifecycle.push(status);
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(lifecycle, ["started", "completed", "reused", "completed"]);
    const stale = {
      ...response(),
      cacheIdentity: { ...packet.cacheIdentity, neighborHash: "changed" },
    };
    await writeFile(
      join(root, "reconciliation/session_000.json"),
      JSON.stringify(stale),
    );
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      resume: true,
    });
    assert.equal(calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a changed ownership plan removes superseded canonical chunk artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-superseded-"));
  try {
    await writeFile(join(root, "placeholder"), "keep");
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: async () => JSON.stringify(response()),
      resume: true,
    });
    await writeFile(
      join(root, "reconciliation", "session_001.json"),
      "superseded",
    );
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: async () => {
        throw new Error("cache-identical job must be reused");
      },
      resume: true,
    });
    assert.deepEqual(await readdir(join(root, "reconciliation")), [
      "session_000.json",
    ]);
    assert.equal(await readFile(join(root, "placeholder"), "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted invalid status is stale and receives exactly one repair", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "reconciliation-resume-invalid-status-"),
  );
  let calls = 0;
  try {
    const invoke = async () => {
      calls += 1;
      return JSON.stringify(response());
    };
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      resume: true,
    });
    await writeFile(
      join(root, "reconciliation/session_000.json"),
      JSON.stringify({ ...response(), status: "invalid" }),
    );
    const result = await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      resume: true,
    });
    assert.equal(calls, 2);
    assert.deepEqual(result.repairedChunkIds, ["session_000"]);
    assert.deepEqual(result.reusedChunkIds, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted status inconsistent with authoritative validation is stale and repaired", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "reconciliation-resume-status-mismatch-"),
  );
  let calls = 0;
  try {
    const invoke = async () => {
      calls += 1;
      return JSON.stringify(response());
    };
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      resume: true,
    });
    await writeFile(
      join(root, "reconciliation/session_000.json"),
      JSON.stringify({ ...response(), status: "needs_review" }),
    );
    const result = await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      resume: true,
    });
    assert.equal(calls, 2);
    assert.deepEqual(result.repairedChunkIds, ["session_000"]);
    assert.equal(result.chunks[0]!.status, "valid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pending summary-safe text is persisted before fallback and exact block mapping replaces it", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-fallback-"));
  let fallbackCalls = 0;
  try {
    const pending = response() as any;
    pending.blocks[0]!.summarySafeText = "";
    pending.summarySafety = { status: "pending", errors: ["unsafe"] };
    const result = await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: async () => JSON.stringify(pending),
      sanitizeSummarySafe: async ({
        blocks,
      }: {
        blocks: readonly { id: string }[];
      }) => {
        fallbackCalls += 1;
        return { [blocks[0]!.id]: "Safe hello." };
      },
    });
    assert.equal(fallbackCalls, 1);
    assert.equal(result.chunks[0]!.summarySafety.status, "valid");
    assert.match(
      await readFile(join(root, "summary_transcript.md"), "utf8"),
      /Safe hello/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic echo accepts reordered keys and hard-invalid unknown events", () => {
  const reordered = JSON.parse(JSON.stringify(response()));
  reordered.chunk = { end: 2, id: "session_000", start: 0 };
  reordered.cacheIdentity = Object.fromEntries(
    Object.entries(packet.cacheIdentity).reverse(),
  );
  assert.equal(validateReconciliationOutput(reordered, job).status, "valid");
  assert.throws(() =>
    validateReconciliationOutput({ ...reordered, status: "valid" }, job),
  );
  reordered.blocks[0].sourceEventIds = ["unknown"];
  assert.throws(
    () => validateReconciliationOutput(reordered, job),
    /unknown event/iu,
  );
});

test("runner owns invocation identity and source echoes before model parsing", () => {
  for (const identity of [
    {},
    {
      schemaVersion: null,
      promptVersion: 42,
      chunk: "wrong",
      cacheIdentity: { inputHash: "truncated" },
    },
  ]) {
    const { schemaVersion, promptVersion, chunk, cacheIdentity, ...content } =
      response();
    const { start, end, ...block } = content.blocks[0]!;
    const model = {
      ...content,
      ...identity,
      blocks: [block],
      materialCorrections: [
        {
          sourceEventId: "e1",
          replacement: "Hello.",
          evidence: ["source event"],
        },
      ],
    };
    const canonical = validateReconciliationOutput(model, job);
    assert.deepEqual(canonical.cacheIdentity, packet.cacheIdentity);
    assert.deepEqual(canonical.chunk, packet.chunk);
    assert.equal(canonical.schemaVersion, schemaVersion);
    assert.equal(canonical.promptVersion, promptVersion);
    assert.deepEqual(
      [canonical.blocks[0]!.start, canonical.blocks[0]!.end],
      [0, 1],
    );
    assert.equal(canonical.materialCorrections[0]!.sourceForm, "hello");
    const omitted = validateReconciliationOutput(
      { ...model, omissions: [{ sourceEventId: "e2", reason: "non-speech" }] },
      {
        ...job,
        authoritativeSourceEvents: [
          ...source,
          { id: "e2", text: "noise", start: 1, end: 2 },
        ],
      },
    );
    assert.deepEqual(omitted.omissions[0], {
      sourceEventId: "e2",
      reason: "non-speech",
      text: "noise",
      start: 1,
      end: 2,
    });
  }
});

test("runner chronologically orders blocks after hydrating authoritative timestamps", () => {
  const later = { id: "e1", text: "later", start: 1, end: 2, confidence: 0.9 };
  const earlier = {
    id: "e2",
    text: "earlier",
    start: 0,
    end: 1,
    confidence: 0.8,
  };
  const orderedJob = { ...job, authoritativeSourceEvents: [later, earlier] };
  const model = response();
  (model as any).blocks = [
    {
      ...model.blocks[0]!,
      id: "later",
      start: 0,
      end: 1,
      text: "Later.",
      summarySafeText: "Later.",
      sourceEventIds: ["e1"],
    },
    {
      ...model.blocks[0]!,
      id: "earlier",
      start: 1,
      end: 2,
      text: "Earlier.",
      summarySafeText: "Earlier.",
      sourceEventIds: ["e2"],
    },
  ];
  const canonical = validateReconciliationOutput(model, orderedJob);
  assert.deepEqual(
    canonical.blocks.map((block) => block.id),
    ["earlier", "later"],
  );
  assert.deepEqual(
    canonical.blocks.map((block) => block.start),
    [0, 1],
  );
});

test("runner keeps the first chronological block owner for duplicate event IDs", () => {
  const second = { id: "e2", text: "world", start: 1, end: 2, confidence: 0.8 };
  const duplicateJob = {
    ...job,
    authoritativeSourceEvents: [...source, second],
  };
  const model = response();
  (model as any).blocks = [
    { ...model.blocks[0]!, id: "b1", sourceEventIds: ["e1"] },
    { ...model.blocks[0]!, id: "b2", sourceEventIds: ["e1", "e2"] },
  ];
  const canonical = validateReconciliationOutput(model, duplicateJob);
  assert.deepEqual(
    canonical.blocks.map((block) => block.sourceEventIds),
    [["e1"], ["e2"]],
  );
});

test("runner promotes misplaced suspicion flags out of block review flags", () => {
  const model = response();
  (model.blocks[0]!.reviewFlags as string[]).push("unsupported-proper-noun");
  const canonical = validateReconciliationOutput(model, job);
  assert.deepEqual(canonical.blocks[0]!.reviewFlags, []);
  assert.deepEqual(canonical.suspicionFlags, ["unsupported-proper-noun"]);
  assert.equal(canonical.status, "needs_review");
});

test("semantic hard-invalid output is diagnostic-only through the runner", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "reconciliation-semantic-invalid-"),
  );
  try {
    const invalid = response();
    invalid.blocks[0]!.sourceEventIds = ["unknown"];
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          invokeReconciliation: async () => JSON.stringify(invalid),
        }),
      /unknown event/iu,
    );
    await assert.rejects(() =>
      access(join(root, "reconciliation/session_000.json")),
    );
    const diagnosticName = (await readdir(join(root, "diagnostics")))[0]!;
    assert.match(
      await readFile(join(root, "diagnostics", diagnosticName), "utf8"),
      /unknown event/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fresh existing artifacts require resume or force, and force regenerates", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-policy-"));
  let calls = 0;
  try {
    const invoke = async () => {
      calls += 1;
      return JSON.stringify(response());
    };
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
    });
    const names = [
      "reconciled_transcript.md",
      "summary_transcript.md",
      "reconciliation_review_queue.md",
    ];
    const joinedBefore = await Promise.all(
      names.map((name) => readFile(join(root, name), "utf8")),
    );
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          invokeReconciliation: invoke,
        }),
      /resume or force/iu,
    );
    assert.deepEqual(
      await Promise.all(
        names.map((name) => readFile(join(root, name), "utf8")),
      ),
      joinedBefore,
    );
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      resume: true,
    });
    await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      invokeReconciliation: invoke,
      force: true,
    });
    assert.equal(calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe chunk IDs before creating paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-path-"));
  try {
    const unsafe = {
      ...job,
      packet: { ...packet, chunk: { ...packet.chunk, id: "../escape" } },
    } as ReconciliationChunkJob;
    await assert.rejects(
      () => runUnifiedReconciliation({ rootDir: root, jobs: [unsafe] }),
      /unsafe reconciliation chunk id/iu,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fallback failure retains pending canonical and skips checkpoint and summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-fallback-fail-"));
  let checkpoints = 0;
  try {
    const pending = response() as any;
    pending.blocks[0].summarySafeText = "";
    pending.summarySafety = { status: "pending", errors: ["unsafe"] };
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          invokeReconciliation: async () => JSON.stringify(pending),
          sanitizeSummarySafe: async () => {
            throw new Error("fallback down");
          },
          checkpoint: () => {
            checkpoints += 1;
          },
        }),
      PendingSummarySafetyError,
    );
    assert.equal(checkpoints, 0);
    assert.match(
      await readFile(join(root, "reconciliation/session_000.json"), "utf8"),
      /pending/,
    );
    await assert.rejects(() => access(join(root, "summary_transcript.md")));
    const resumed = await runUnifiedReconciliation({
      rootDir: root,
      jobs: [job],
      resume: true,
      invokeReconciliation: async () => {
        throw new Error("ordinary must not retry");
      },
      sanitizeSummarySafe: async () => ({ b1: "Recovered safely." }),
    });
    assert.equal(resumed.chunks[0]!.summarySafety.status, "valid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("injected operations abort on timeout and reject oversized output", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-bounds-"));
  let aborted = false;
  try {
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          timeoutMs: 10,
          invokeReconciliation: async (
            _job: ReconciliationChunkJob,
            _prompt: string,
            signal: AbortSignal,
          ) =>
            await new Promise<string>((resolve) => {
              signal.addEventListener("abort", () => {
                aborted = true;
                resolve(JSON.stringify(response()));
              });
            }),
        }),
      /timed out/iu,
    );
    assert.equal(aborted, true);
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          maxOutputBytes: 8,
          invokeReconciliation: async () => "x".repeat(100),
        }),
      /output exceeded bound/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects excessive runner and prompt bounds before invocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-hard-bounds-"));
  let calls = 0;
  const invokeReconciliation = async () => {
    calls += 1;
    return JSON.stringify(response());
  };
  try {
    await runUnifiedReconciliation({
      rootDir: join(root, "accepted-timeout"),
      jobs: [job],
      invokeReconciliation,
      timeoutMs: 900_000,
    });
    for (const options of [
      { timeoutMs: 1_200_001 },
      { maxOutputBytes: 20_000_001 },
      { maxTurns: 1_001 },
    ]) {
      await assert.rejects(
        () =>
          runUnifiedReconciliation({
            rootDir: root,
            jobs: [job],
            invokeReconciliation,
            ...options,
          }),
        /exceeds maximum/iu,
      );
    }
    const oversized = {
      ...job,
      packet: { ...job.packet, correctionRules: ["x".repeat(20_000_001)] },
    } as ReconciliationChunkJob;
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [oversized],
          invokeReconciliation,
        }),
      /prompt exceeded.*promptBytes=.*authoritativeEvents=.*largestEventBytes=/iu,
    );
    assert.equal(calls, 1);
    const diagnostics = await readdir(join(root, "diagnostics"));
    assert.equal(diagnostics.length, 1);
    const diagnostic = await readFile(
      join(root, "diagnostics", diagnostics[0]!),
      "utf8",
    );
    assert.doesNotMatch(diagnostic, /x{256}/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic publication preserves the prior target and cleans interrupted temp files", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-atomic-"));
  const target = join(root, "reconciliation/session_000.json");
  try {
    const canonical = validateReconciliationOutput(response(), job);
    await writeCanonicalReconciliationAtomic(target, canonical);
    const original = await readFile(target, "utf8");
    const replacement = {
      ...canonical,
      blocks: canonical.blocks.map(
        (block: (typeof canonical.blocks)[number]) => ({
          ...block,
          text: "Replacement.",
        }),
      ),
    };
    await assert.rejects(
      () =>
        writeCanonicalReconciliationAtomic(target, replacement, {
          beforeRename: () => {
            throw new Error("interrupted before publish");
          },
        }),
      /interrupted before publish/iu,
    );
    assert.equal(await readFile(target, "utf8"), original);
    assert.deepEqual(
      (await readdir(dirname(target))).filter((name) => name.endsWith(".tmp")),
      [],
    );
    await writeCanonicalReconciliationAtomic(target, replacement);
    assert.match(await readFile(target, "utf8"), /Replacement\./u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic joined-text publication preserves prior bytes and cleans interruption debris", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-text-atomic-"));
  const target = join(root, "reconciled_transcript.md");
  try {
    await writeFile(target, "prior\n");
    await assert.rejects(
      () =>
        writeReconciliationTextAtomic(target, "replacement\n", {
          beforeRename: () => {
            throw new Error("interrupted derivative publish");
          },
        }),
      /interrupted derivative publish/iu,
    );
    assert.equal(await readFile(target, "utf8"), "prior\n");
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.endsWith(".tmp")),
      [],
    );
    await writeReconciliationTextAtomic(target, "replacement\n");
    assert.equal(await readFile(target, "utf8"), "replacement\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded Hermes handles an already-aborted signal and kills a TERM-ignoring descendant group with the requested cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-hermes-"));
  const command = join(root, "synthetic-hermes.mjs");
  const marker = join(root, "cwd.txt");
  const pidFile = join(root, "child.pid");
  try {
    await writeFile(
      command,
      `#!/usr/bin/env node\nimport { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, process.cwd());\nprocess.stderr.write("provider-stream-stalled-before-terminal-response\\n");\nprocess.on("SIGTERM", () => { process.stderr.write("provider-cancel-acknowledged\\n"); process.exit(0); });\nconst child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });\nwriteFileSync(${JSON.stringify(pidFile)}, String(child.pid));\nsetInterval(()=>{},1000);\n`,
    );
    await chmod(command, 0o755);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      () =>
        boundedHermes(job, "x", aborted.signal, {
          timeoutMs: 100,
          maxOutputBytes: 1000,
          hermesCommand: command,
          maxTurns: 1,
          repositoryCwd: root,
        }),
      /aborted/iu,
    );
    const started = Date.now();
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          timeoutMs: 100,
          maxOutputBytes: 1000,
          hermesCommand: command,
          maxTurns: 1,
          repositoryCwd: root,
        }),
      /timed out|failed/iu,
    );
    assert.ok(Date.now() - started < 3000);
    const diagnosticPath = join(
      root,
      "diagnostics",
      (await readdir(join(root, "diagnostics")))[0]!,
    );
    const diagnostic = JSON.parse(await readFile(diagnosticPath, "utf8")) as {
      stderr: string;
      error: string;
    };
    assert.match(
      diagnostic.stderr,
      /provider-stream-stalled-before-terminal-response/u,
    );
    assert.match(diagnostic.stderr, /provider-cancel-acknowledged/u);
    assert.match(diagnostic.error, /timed out/iu);
    assert.equal((await stat(diagnosticPath)).mode & 0o777, 0o600);
    const readyDeadline = Date.now() + 300;
    while (Date.now() < readyDeadline) {
      try {
        await access(marker);
        await access(pidFile);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.equal(await readFile(marker, "utf8"), root);
    const pid = Number(await readFile(pidFile, "utf8"));
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        if (stat.split(" ")[2] === "Z") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch {
        break;
      }
    }
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      assert.equal(stat.split(" ")[2], "Z");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded Hermes settles during TERM grace when the owned group exits", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "reconciliation-hermes-cooperative-"),
  );
  const command = join(root, "cooperative-hermes.mjs");
  try {
    await writeFile(
      command,
      "#!/usr/bin/env node\nsetInterval(()=>{},1000);\n",
    );
    await chmod(command, 0o755);
    const started = Date.now();
    await assert.rejects(
      () =>
        boundedHermes(job, "x", new AbortController().signal, {
          timeoutMs: 20,
          maxOutputBytes: 1_000,
          hermesCommand: command,
          maxTurns: 1,
          repositoryCwd: root,
        }),
      /timed out/iu,
    );
    assert.ok(Date.now() - started < 250);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded Hermes supplies large prompts through an owner-only temporary file and cleans it", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "reconciliation-hermes-prompt-file-"),
  );
  const command = join(root, "prompt-file-hermes.mjs");
  const marker = join(root, "prompt-marker.json");
  const largePrompt = "evidence:" + "x".repeat(220_000);
  try {
    const relativePromptDir = `relative-prompt-${process.pid}-${Date.now()}`;
    await assert.rejects(
      () =>
        boundedHermes(job, largePrompt, new AbortController().signal, {
          timeoutMs: 2_000,
          maxOutputBytes: 10_000,
          hermesCommand: command,
          maxTurns: 1,
          repositoryCwd: root,
          promptDir: relativePromptDir,
        }),
      /absolute path/iu,
    );
    await assert.rejects(access(join(process.cwd(), relativePromptDir)), {
      code: "ENOENT",
    });
    await assert.rejects(
      () =>
        boundedHermes(job, largePrompt, new AbortController().signal, {
          timeoutMs: 2_000,
          maxOutputBytes: 10_000,
          hermesCommand: join(root, "missing-hermes"),
          maxTurns: 1,
          repositoryCwd: root,
          promptDir: root,
        }),
      /ENOENT|spawn/iu,
    );
    assert.deepEqual(
      (await readdir(root)).filter((name) =>
        name.includes("reconciliation-prompt"),
      ),
      [],
    );
    await writeFile(
      command,
      `#!/usr/bin/env node\nimport { readFileSync, statSync, writeFileSync } from "node:fs";\nconst query = process.argv.at(-1);\nconst promptPath = JSON.parse(query.slice(query.lastIndexOf(": ") + 2));\nconst prompt = readFileSync(promptPath, "utf8");\nwriteFileSync(${JSON.stringify(marker)}, JSON.stringify({ query, prompt, mode: statSync(promptPath).mode & 0o777 }));\nprocess.stdout.write(${JSON.stringify(JSON.stringify(response()))});\n`,
    );
    await chmod(command, 0o755);
    const result = await boundedHermes(
      job,
      largePrompt,
      new AbortController().signal,
      {
        timeoutMs: 2_000,
        maxOutputBytes: 10_000,
        hermesCommand: command,
        maxTurns: 1,
        repositoryCwd: root,
        promptDir: root,
      },
    );
    assert.deepEqual(JSON.parse(result.stdout), response());
    const observed = JSON.parse(await readFile(marker, "utf8")) as {
      query: string;
      prompt: string;
      mode: number;
    };
    assert.equal(observed.prompt, largePrompt);
    assert.equal(observed.mode, 0o600);
    assert.ok(Buffer.byteLength(observed.query, "utf8") < 4_096);
    assert.doesNotMatch(observed.query, /evidence:x{100}/u);
    assert.deepEqual(
      (await readdir(root)).filter((name) =>
        name.includes("reconciliation-prompt"),
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pending output without a sanitizer is durable but cannot checkpoint, and diagnostics are bounded/sanitized", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-safety-"));
  let checkpoints = 0;
  try {
    const pending = response() as any;
    pending.blocks[0].summarySafeText = "";
    pending.summarySafety = { status: "pending", errors: ["unsafe"] };
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          maxOutputBytes: 1200,
          invokeReconciliation: async () => ({
            stdout: JSON.stringify(pending),
            metadata: { token: "m", password: "p", model: "safe" },
          }),
          checkpoint: () => {
            checkpoints += 1;
          },
        }),
      PendingSummarySafetyError,
    );
    assert.equal(checkpoints, 0);
    const diagnostics = await Promise.all(
      (await readdir(join(root, "diagnostics"))).map((name) =>
        readFile(join(root, "diagnostics", name), "utf8"),
      ),
    );
    const diagnostic = diagnostics.join("\n");
    assert.doesNotMatch(diagnostic, /token|password/iu);
    assert.match(diagnostic, /model/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful reconciliation requires its raw diagnostic to publish before canonical JSON", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "reconciliation-diagnostic-custody-"),
  );
  try {
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          invokeReconciliation: async () => JSON.stringify(response()),
          diagnosticWriter: async () => {
            throw new Error("diagnostic disk full");
          },
        }),
      /diagnostic disk full/iu,
    );
    await assert.rejects(() =>
      access(join(root, "reconciliation/session_000.json")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed run removes stale joined derivatives and diagnostic failure never replaces the primary error", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconciliation-stale-"));
  try {
    await Promise.all(
      [
        "reconciled_transcript.md",
        "summary_transcript.md",
        "reconciliation_review_queue.md",
      ].map((name) => writeFile(join(root, name), "stale")),
    );
    const primary = new Error("primary reconciliation failure");
    await assert.rejects(
      () =>
        runUnifiedReconciliation({
          rootDir: root,
          jobs: [job],
          force: true,
          invokeReconciliation: async () => {
            throw primary;
          },
          diagnosticWriter: async () => {
            throw new Error("disk full");
          },
        }),
      /primary reconciliation failure.*diagnostic recording failed/iu,
    );
    await assert.rejects(() => access(join(root, "summary_transcript.md")));
    await assert.rejects(() => access(join(root, "reconciled_transcript.md")));
    await assert.rejects(() =>
      access(join(root, "reconciliation_review_queue.md")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
