import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { formatArchiveSummary, isExistingOutputSkip } from "./bulk.js";
import { archiveSession, buildAudioRedactionArgs, readStructuredPublicProjection } from "./impl.js";
import { parsePrivateRedactionsYaml } from "./privacy.js";

test("skips existing outputs only in all mode without force", () => {
  assert.equal(
    isExistingOutputSkip({ all: true, force: false, destinationExists: true }),
    true,
  );
  assert.equal(
    isExistingOutputSkip({ all: true, destinationExists: true }),
    true,
  );
  assert.equal(
    isExistingOutputSkip({ all: true, force: true, destinationExists: true }),
    false,
  );
  assert.equal(
    isExistingOutputSkip({ all: false, force: false, destinationExists: true }),
    false,
  );
  assert.equal(
    isExistingOutputSkip({ all: true, force: false, destinationExists: false }),
    false,
  );
});

test("formats archive all summary with successes, skips, and failures", () => {
  assert.equal(
    formatArchiveSummary([
      {
        status: "archived",
        session: "session-a",
        destination: "/out/session-a.zip",
      },
      {
        status: "skipped",
        session: "session-b",
        destination: "/out/session-b.zip",
      },
      {
        status: "failed",
        session: "session-c",
        error: "Missing required file",
      },
    ]),
    [
      "Archive summary:",
      "  Total: 3",
      "  Archived: 1",
      "  Skipped existing: 1",
      "  Failed: 1",
      "",
      "Failures:",
      "  - session-c: Missing required file",
    ].join("\n"),
  );
});

test("builds bounded lossless audio-redaction filters before public encoding", () => {
  const manifest = parsePrivateRedactionsYaml(`version: 1
reviewed: true
audio:
  - id: opening
    start: "00:00:01.000"
    end: "00:00:02.000"
    channels: all
    reason: physical-speaker-identity
    fadeMilliseconds: 20
transcripts: []
speakerLabels: neutralize
`);
  const args = buildAudioRedactionArgs("/private/session.flac", "/tmp/scrubbed.flac", manifest.audio, 10);
  assert.deepEqual(args.slice(0, 6), ["-hide_banner", "-nostats", "-y", "-i", "/private/session.flac", "-vn"]);
  assert.equal(args[6], "-filter:a");
  assert.match(args[7]!, /volume=.*0\.98.*2\.02/iu);
  assert.deepEqual(args.slice(-3), ["-c:a", "flac", "/tmp/scrubbed.flac"]);
  assert.throws(() => buildAudioRedactionArgs("in", "out", manifest.audio, 1.5), /exceeds source duration/iu);
  assert.throws(() => buildAudioRedactionArgs("in", "out", [...manifest.audio, { ...manifest.audio[0]!, id: "overlap", start: "00:00:01.500", end: "00:00:02.500" }], 10), /must not overlap/iu);
});

function canonicalFixture(options: { pending?: boolean } = {}) {
  return {
    schemaVersion: "reconciliation.v1", promptVersion: "reconciliation.prompt.v1",
    chunk: { id: "session_000", start: 0, end: 3 },
    cacheIdentity: { inputHash: "i", contextHash: "c", sourceHash: "s" },
    blocks: [
      { id: "b0", start: 0, end: 2, kind: "dialogue", text: "Readable first.", summarySafeText: "SUMMARY FIRST", characterCandidate: "Hero", characterConfidence: "confirmed", attributionBasis: ["direct"], sourceEventIds: ["session_000:event_0000"], reviewFlags: [] },
      { id: "b1", start: 1, end: 3, kind: "dialogue", text: "Readable overlap.", summarySafeText: "SUMMARY OVERLAP", characterConfidence: "unknown", attributionBasis: ["none"], sourceEventIds: ["session_000:event_0001"], reviewFlags: [] },
    ],
    omissions: [], materialCorrections: [], suspicionFlags: [], reviewNotes: [],
    summarySafety: options.pending ? { status: "pending", errors: ["pending"] } : { status: "valid", errors: [] },
    status: "valid",
  };
}

async function makeProjectionFixture(canonical: unknown, redactions = "transcripts: []"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bf-public-projection-"));
  await mkdir(join(root, "reconciliation"), { recursive: true });
  await mkdir(join(root, "raw_transcription", "alignment"), { recursive: true });
  await writeFile(join(root, "redactions.yaml"), `version: 1\nreviewed: true\naudio: []\n${redactions}\nspeakerLabels: neutralize\n`);
  await writeFile(join(root, "reconciliation", "session_000.json"), typeof canonical === "string" ? canonical : JSON.stringify(canonical));
  await writeFile(join(root, "raw_transcription", "alignment", "session_000.json"), JSON.stringify({ version: 1, events: [
    { text: "Source first", sourcePass: "stereo", globalStart: 0, globalEnd: 2, alternatives: [] },
    { text: "Source overlap", sourcePass: "stereo", globalStart: 1, globalEnd: 3, alternatives: [] },
  ] }));
  return root;
}

test("projects readable text with overlap, confidence, and no private fields", async () => {
  const root = await makeProjectionFixture(canonicalFixture(), `transcripts:\n  - id: opening\n    start: "00:00:00.000"\n    end: "00:00:00.500"\n    replacement: "[microphone identity check redacted]"`);
  try {
    const text = await readStructuredPublicProjection(root, join(root, "reconciliation"));
    assert.doesNotMatch(text, /Readable first/);
    assert.match(text, /\[microphone identity check redacted\]/);
    assert.match(text, /Readable overlap/);
    assert.doesNotMatch(text, /SUMMARY FIRST|SUMMARY OVERLAP|physical|sourceEventIds|channel:/i);
    assert.match(text, /Confidence legend/);
    assert.match(text, /\[Player \/ character unknown\]/);
    const cleanRoot = await makeProjectionFixture(canonicalFixture());
    try {
      const cleanText = await readStructuredPublicProjection(cleanRoot, join(cleanRoot, "reconciliation"));
      assert.match(cleanText, /\[Hero\]/);
      assert.match(cleanText, /\[Player \/ character unknown\]/);
    } finally { await rm(cleanRoot, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects pending and malformed canonical artifacts", async () => {
  const pendingRoot = await makeProjectionFixture(canonicalFixture({ pending: true }));
  try { await assert.rejects(() => readStructuredPublicProjection(pendingRoot, join(pendingRoot, "reconciliation")), /pending summary safety/i); }
  finally { await rm(pendingRoot, { recursive: true, force: true }); }
  const malformedRoot = await makeProjectionFixture("not-json");
  try { await assert.rejects(() => readStructuredPublicProjection(malformedRoot, join(malformedRoot, "reconciliation")), /malformed canonical/i); }
  finally { await rm(malformedRoot, { recursive: true, force: true }); }
});

test("reconstructs one canonical session chunk from every owned alignment artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-public-multi-alignment-"));
  await mkdir(join(root, "reconciliation"), { recursive: true });
  await mkdir(join(root, "raw_transcription", "alignment"), { recursive: true });
  await writeFile(join(root, "redactions.yaml"), "version: 1\nreviewed: true\naudio: []\ntranscripts: []\nspeakerLabels: neutralize\n");
  const canonical = canonicalFixture();
  canonical.chunk.end = 6;
  canonical.blocks[0]!.start = 0;
  canonical.blocks[0]!.end = 2;
  canonical.blocks[0]!.sourceEventIds = ["session_000:event_0000"];
  canonical.blocks[1]!.start = 4;
  canonical.blocks[1]!.end = 6;
  canonical.blocks[1]!.sourceEventIds = ["session_000:event_0001"];
  await writeFile(join(root, "reconciliation", "session_000.json"), JSON.stringify(canonical));
  await writeFile(join(root, "raw_transcription", "alignment", "session_000.json"), JSON.stringify({ version: 1, events: [
    { text: "First STT window", sourcePass: "stereo", globalStart: 0, globalEnd: 2, alternatives: [] },
  ] }));
  await writeFile(join(root, "raw_transcription", "alignment", "session_001.json"), JSON.stringify({ version: 1, events: [
    { text: "Second STT window", sourcePass: "stereo", globalStart: 4, globalEnd: 6, alternatives: [] },
  ] }));
  try {
    const text = await readStructuredPublicProjection(root, join(root, "reconciliation"));
    assert.match(text, /Readable first/u);
    assert.match(text, /Readable overlap/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("projects readable text from canonical chunks whose source IDs restart per chunk", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-public-two-canonical-chunks-"));
  await mkdir(join(root, "reconciliation"), { recursive: true });
  await mkdir(join(root, "raw_transcription", "alignment"), { recursive: true });
  await writeFile(join(root, "redactions.yaml"), "version: 1\nreviewed: true\naudio: []\ntranscripts: []\nspeakerLabels: neutralize\n");

  const first = canonicalFixture();
  first.chunk = { id: "session_000", start: 0, end: 3 };
  first.blocks[0]!.text = "Readable first chunk.";
  first.blocks[0]!.start = 0;
  first.blocks[0]!.end = 1;
  first.blocks[0]!.sourceEventIds = ["session_000:event_0000"];
  first.blocks[1]!.text = "Readable first continuation.";
  first.blocks[1]!.start = 1;
  first.blocks[1]!.end = 3;
  first.blocks[1]!.sourceEventIds = ["session_000:event_0001"];

  const second = canonicalFixture();
  second.chunk = { id: "session_001", start: 3, end: 6 };
  second.blocks = [{
    ...second.blocks[0]!,
    text: "Readable second chunk.",
    start: 4,
    end: 6,
    sourceEventIds: ["session_001:event_0000"],
  }];

  await writeFile(join(root, "reconciliation", "session_000.json"), JSON.stringify(first));
  await writeFile(join(root, "reconciliation", "session_001.json"), JSON.stringify(second));
  await writeFile(join(root, "raw_transcription", "alignment", "session_000.json"), JSON.stringify({ version: 1, events: [
    { text: "First alignment event", sourcePass: "stereo", globalStart: 0, globalEnd: 1, alternatives: [] },
    { text: "First continuation event", sourcePass: "stereo", globalStart: 1, globalEnd: 3, alternatives: [] },
  ] }));
  await writeFile(join(root, "raw_transcription", "alignment", "session_001.json"), JSON.stringify({ version: 1, events: [
    { text: "Second alignment event", sourcePass: "stereo", globalStart: 4, globalEnd: 6, alternatives: [] },
  ] }));

  try {
    const text = await readStructuredPublicProjection(root, join(root, "reconciliation"));
    assert.match(text, /Readable first chunk\./u);
    assert.match(text, /Readable second chunk\./u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects canonical reconciliation directories that escape the private session root", async () => {
  const root = await makeProjectionFixture(canonicalFixture());
  const outsideDir = await mkdtemp(join(tmpdir(), "bf-public-projection-outside-"));
  await writeFile(join(outsideDir, "session_000.json"), JSON.stringify(canonicalFixture()));
  await rm(join(root, "reconciliation"), { recursive: true, force: true });
  await symlink(outsideDir, join(root, "reconciliation"));
  try {
    await assert.rejects(
      () => readStructuredPublicProjection(root, join(root, "reconciliation")),
      /directory|symbolic link|escapes/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("canonical archive publication exposes only the public allowlist in unpacked and zip modes", async () => {
  const transcribeDir = await mkdtemp(join(tmpdir(), "bf-canonical-archive-"));
  const sessionDir = join(transcribeDir, "session-2026-08-20");
  await mkdir(join(sessionDir, "normalized"), { recursive: true });
  await mkdir(join(sessionDir, "reconciliation"), { recursive: true });
  await mkdir(join(sessionDir, "raw_transcription", "alignment"), { recursive: true });
  await mkdir(join(sessionDir, "raw_chunks"), { recursive: true });
  await writeFile(join(sessionDir, "normalized", "session.flac"), "synthetic lossless audio");
  await writeFile(join(sessionDir, "redactions.yaml"), "version: 1\nreviewed: true\naudio: []\ntranscripts: []\nspeakerLabels: neutralize\n");
  await writeFile(join(sessionDir, "reconciliation", "session_000.json"), JSON.stringify(canonicalFixture()));
  await writeFile(join(sessionDir, "raw_transcription", "alignment", "session_000.json"), JSON.stringify({ version: 1, events: [
    { text: "Source first", sourcePass: "stereo", globalStart: 0, globalEnd: 2, physicalSpeaker: "Private Person", alternatives: [] },
    { text: "Source overlap", sourcePass: "stereo", globalStart: 1, globalEnd: 3, physicalSpeaker: "Private Person", alternatives: [] },
  ] }));
  await writeFile(join(sessionDir, "raw_transcription", "private.md"), "PRIVATE TRANSCRIPT");
  await writeFile(join(sessionDir, "raw_chunks", "private.json"), JSON.stringify({ physicalSpeaker: "Private Person" }));
  await writeFile(join(sessionDir, "channel-map.yml"), "speaker: Private Person\n");
  await writeFile(join(sessionDir, "raw_transcript.md"), "PRIVATE RAW\n");
  await writeFile(join(sessionDir, "corrected_transcript.md"), "PRIVATE CORRECTED\n");
  await writeFile(join(sessionDir, "summary_transcript.md"), "PRIVATE SUMMARY\n");
  await writeFile(join(transcribeDir, "corrections.yaml"), "version: 1\nrules: []\n");
  const sink = { write: () => true };
  const context = { currentPath: transcribeDir, process: { stdout: sink, stderr: sink } } as unknown as Parameters<typeof archiveSession>[0]["context"];
  try {
    const unpacked = await archiveSession({
      context, cwd: transcribeDir, session: sessionDir, flags: {},
      settings: { transcribeDir, outputDir: join(transcribeDir, "public-unpacked"), compression: false, audioBitrate: "32k" },
      dependencies: { encodeToOpus: async ({ input, output }) => copyFile(input, output) },
    });
    assert.deepEqual((await readdir(unpacked)).sort(), ["corrections.yaml", "privacy-review.yaml", "reconciled_transcript.md", "session-audio.opus"]);
    assert.doesNotMatch(await readFile(join(unpacked, "reconciled_transcript.md"), "utf8"), /Private Person|PRIVATE|physicalSpeaker/iu);

    const zipOutputDir = join(transcribeDir, "public-zip");
    await mkdir(zipOutputDir, { recursive: true });
    let zipNames: string[] = [];
    await archiveSession({
      context, cwd: transcribeDir, session: sessionDir, flags: {},
      settings: { transcribeDir, outputDir: zipOutputDir, compression: true, audioBitrate: "32k" },
      dependencies: {
        encodeToOpus: async ({ input, output }) => copyFile(input, output),
        createZipArchive: async (entries, output) => { zipNames = entries.map((entry) => entry.name).sort(); await writeFile(output, "synthetic zip"); },
      },
    });
    assert.deepEqual(zipNames, ["corrections.yaml", "privacy-review.yaml", "reconciled_transcript.md", "session-audio.opus"]);
  } finally { await rm(transcribeDir, { recursive: true, force: true }); }
});

test("restarts stable event ordinals for each canonical logical chunk", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-public-multi-chunk-"));
  await mkdir(join(root, "reconciliation"), { recursive: true });
  await mkdir(join(root, "raw_transcription", "alignment"), { recursive: true });
  await writeFile(join(root, "redactions.yaml"), "version: 1\nreviewed: true\naudio: []\ntranscripts: []\nspeakerLabels: neutralize\n");
  const first = canonicalFixture();
  const second = canonicalFixture();
  second.chunk = { id: "session_001", start: 4, end: 6 };
  second.blocks = [{
    ...second.blocks[0]!, id: "b2", start: 4, end: 6,
    text: "Readable second chunk.", summarySafeText: "SAFE SECOND CHUNK",
    sourceEventIds: ["session_001:event_0000"],
  }];
  await writeFile(join(root, "reconciliation", "session_000.json"), JSON.stringify(first));
  await writeFile(join(root, "reconciliation", "session_001.json"), JSON.stringify(second));
  await writeFile(join(root, "raw_transcription", "alignment", "session_000.json"), JSON.stringify({ version: 1, events: [
    { text: "Source first", sourcePass: "stereo", globalStart: 0, globalEnd: 2, alternatives: [] },
    { text: "Source overlap", sourcePass: "stereo", globalStart: 1, globalEnd: 3, alternatives: [] },
  ] }));
  await writeFile(join(root, "raw_transcription", "alignment", "session_001.json"), JSON.stringify({ version: 1, events: [
    { text: "Source second", sourcePass: "stereo", globalStart: 4, globalEnd: 6, alternatives: [] },
  ] }));
  try {
    const text = await readStructuredPublicProjection(root, join(root, "reconciliation"));
    assert.match(text, /Readable first/u);
    assert.match(text, /Readable second chunk/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
