import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { formatArchiveSummary, isExistingOutputSkip } from "./bulk.js";
import { archiveSession, buildAudioRedactionArgs, readStructuredPublicProjection } from "./impl.js";
import { parsePrivateRedactionsYaml, parsePublicPrivacyReceiptYaml } from "./privacy.js";

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
  assert.match(args[7]!, /aeval=.*val\(ch\)/iu);
  assert.match(args[7]!, /0\.98.*2\.02/iu);
  assert.deepEqual(args.slice(-3), ["-c:a", "flac", "/tmp/scrubbed.flac"]);
  assert.throws(() => buildAudioRedactionArgs("in", "out", manifest.audio, 1.5), /exceeds source duration/iu);
  assert.throws(() => buildAudioRedactionArgs("in", "out", [...manifest.audio, { ...manifest.audio[0]!, id: "overlap", start: "00:00:01.500", end: "00:00:02.500" }], 10), /must not overlap/iu);
});

for (const channels of [1, 2]) {
test(`applies sample-accurate ${channels}-channel silence while preserving duration and neighboring audio`, async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-audio-redaction-"));
  const source = join(root, "source.flac");
  const output = join(root, "redacted.flac");
  try {
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-ac", String(channels), "-c:a", "flac", source,
    ]);
    const args = buildAudioRedactionArgs(source, output, [{
      id: "synthetic",
      start: "00:00:00.500",
      end: "00:00:01.500",
      channels: "all",
      reason: "private-conversation",
      fadeMilliseconds: 20,
    }], 2);
    execFileSync("ffmpeg", args, { stdio: "ignore" });
    const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", output, "-f", "f32le", "-acodec", "pcm_f32le", "-"]);
    const frames = pcm.length / (channels * 4);
    const maxAmplitude = (startFrame: number, endFrame: number): number => {
      let maximum = 0;
      for (let frame = startFrame; frame < endFrame; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) maximum = Math.max(maximum, Math.abs(pcm.readFloatLE((frame * channels + channel) * 4)));
      }
      return maximum;
    };
    assert.equal(frames, 96_000);
    assert.equal(maxAmplitude(24_000, 72_000), 0);
    assert.ok(maxAmplitude(12_000, 21_600) > 0.01);
    assert.ok(maxAmplitude(74_400, 84_000) > 0.01);
  } finally { await rm(root, { recursive: true, force: true }); }
});
}

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
    assert.deepEqual((await readdir(unpacked)).sort(), ["privacy-review.yaml", "reconciled_transcript.md", "session-audio.opus"]);
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
    assert.deepEqual(zipNames, ["privacy-review.yaml", "reconciled_transcript.md", "session-audio.opus"]);
  } finally { await rm(transcribeDir, { recursive: true, force: true }); }
});

async function makeLegacyArchiveFixture(options: {
  includeReconciled?: boolean;
  includeCorrected?: boolean;
  emptyReconciled?: boolean;
  failingRedaction?: boolean;
  includeManifest?: boolean;
} = {}): Promise<{ transcribeDir: string; sessionDir: string }> {
  const transcribeDir = await mkdtemp(join(tmpdir(), "bf-legacy-archive-"));
  const sessionDir = join(transcribeDir, "session-legacy");
  await mkdir(join(sessionDir, "normalized"), { recursive: true });
  await mkdir(join(sessionDir, "raw_transcription", "alignment"), { recursive: true });
  await mkdir(join(sessionDir, "raw_chunks"), { recursive: true });
  await writeFile(join(sessionDir, "normalized", "session.flac"), "synthetic lossless audio");
  if (options.includeManifest !== false) {
    await writeFile(join(sessionDir, "redactions.yaml"), `version: 1
reviewed: true
audio: []
transcripts:
  - id: private-detail
    start: "00:00:${options.failingRedaction ? "05.000" : "01.000"}"
    end: "00:00:${options.failingRedaction ? "06.000" : "02.000"}"
    replacement: "[private conversation redacted]"
speakerLabels: neutralize
`);
  }
  if (options.includeReconciled !== false) {
    await writeFile(join(sessionDir, "reconciled_transcript.md"), options.emptyReconciled ? "" :
      "[00:00:00 - 00:00:01] [speaker:Private Person] Public opening.\n" +
      "[00:00:01 - 00:00:02] [speaker:Private Person] Private detail.\n" +
      "[00:00:02 - 00:00:03] [speaker:Private Person] Public ending.\n");
  }
  if (options.includeCorrected) {
    await writeFile(join(sessionDir, "corrected_transcript.md"),
      "[00:00:00 - 00:00:01] Corrected fallback preface.\n" +
      "[00:00:01 - 00:00:02] Corrected fallback final.\n");
  }
  await writeFile(join(sessionDir, "raw_transcript.md"), "RAW PRIVATE TRANSCRIPT\n");
  await writeFile(join(sessionDir, "correction_notes.md"), "PRIVATE CORRECTION NOTES\n");
  await writeFile(join(sessionDir, "hermes_review_notes.md"), "PRIVATE REVIEW NOTES\n");
  await writeFile(join(sessionDir, "raw_transcription", "alignment", "private.json"), "RAW ASR JSON\n");
  await writeFile(join(sessionDir, "raw_chunks", "private.json"), "RAW CHUNK JSON\n");
  await writeFile(join(sessionDir, "channel-map.yml"), "speaker: Private Person\n");
  await writeFile(join(sessionDir, "checkpoint.json"), "CHECKPOINT METADATA\n");
  await writeFile(join(sessionDir, "manifest.json"), "SESSION METADATA\n");
  await writeFile(join(transcribeDir, "corrections.yaml"), "SHARED CORRECTIONS\n");
  return { transcribeDir, sessionDir };
}

function archiveTestContext() {
  const sink = { write: () => true };
  return { currentPath: "/tmp", process: { stdout: sink, stderr: sink } } as unknown as Parameters<typeof archiveSession>[0]["context"];
}

test("legacy archive publishes one redacted final transcript and receipt in directory and zip modes", async () => {
  for (const compression of [false, true]) {
    const fixture = await makeLegacyArchiveFixture({ includeCorrected: true });
    const outputDir = join(fixture.transcribeDir, compression ? "zip-output" : "directory-output");
    await mkdir(outputDir, { recursive: true });
    const zipPayloads: Record<string, string> = {};
    try {
      const destination = await archiveSession({
        context: archiveTestContext(),
        cwd: fixture.transcribeDir,
        session: fixture.sessionDir,
        flags: {},
        settings: { transcribeDir: fixture.transcribeDir, outputDir, compression, audioBitrate: "32k" },
        dependencies: {
          encodeToOpus: async ({ input, output }) => copyFile(input, output),
          createZipArchive: async (entries, output) => {
            for (const entry of entries) zipPayloads[entry.name] = await readFile(entry.path, "utf8");
            await writeFile(output, "synthetic zip");
          },
        },
      });
      const names = compression
        ? Object.keys(zipPayloads).sort()
        : (await readdir(destination)).sort();
      assert.deepEqual(names, ["privacy-review.yaml", "reconciled_transcript.md", "session-audio.opus"]);
      const contents = compression
        ? zipPayloads
        : {
            "reconciled_transcript.md": await readFile(join(destination, "reconciled_transcript.md"), "utf8"),
            "privacy-review.yaml": await readFile(join(destination, "privacy-review.yaml"), "utf8"),
            "session-audio.opus": await readFile(join(destination, "session-audio.opus"), "utf8"),
          };
      assert.match(contents["reconciled_transcript.md"]!, /\[private conversation redacted\]/u);
      assert.match(contents["reconciled_transcript.md"]!, /Public opening|Public ending/u);
      assert.doesNotMatch(Object.values(contents).join("\n"), /RAW PRIVATE|CORRECTION NOTES|REVIEW NOTES|RAW ASR|CHECKPOINT|SESSION METADATA|SHARED CORRECTIONS|Private Person/iu);
      const receipt = parsePublicPrivacyReceiptYaml(contents["privacy-review.yaml"]!);
      assert.deepEqual(receipt, {
        version: 1,
        reviewed: true,
        policy: "transcript-archive-privacy-v1",
        audioRedactionsApplied: 0,
        transcriptRedactionsApplied: 1,
        speakerLabels: "neutralized",
      });
    } finally { await rm(fixture.transcribeDir, { recursive: true, force: true }); }
  }
});

test("archive rejects destinations overlapping the private session without changing sources", async () => {
  for (const compression of [false, true]) {
    for (const nested of [false, true]) {
      if (compression && !nested) continue;
      const fixture = await makeLegacyArchiveFixture();
      const outputDir = nested ? join(fixture.sessionDir, "new-output") : fixture.transcribeDir;
      const beforeNames = await readdir(fixture.sessionDir, { recursive: true });
      const manifest = await readFile(join(fixture.sessionDir, "redactions.yaml"));
      let encoded = false;
      try {
        await assert.rejects(() => archiveSession({
          context: archiveTestContext(), cwd: fixture.transcribeDir, session: fixture.sessionDir,
          flags: { force: true },
          settings: { transcribeDir: fixture.transcribeDir, outputDir, compression, audioBitrate: "32k" },
          dependencies: {
            encodeToOpus: async ({ input, output }) => { encoded = true; await copyFile(input, output); },
            createZipArchive: async (_entries, output) => { await writeFile(output, "synthetic zip"); },
          },
        }), /Archive destination overlaps private session/iu);
        assert.equal(encoded, false);
        assert.deepEqual(await readdir(fixture.sessionDir, { recursive: true }), beforeNames);
        assert.deepEqual(await readFile(join(fixture.sessionDir, "redactions.yaml")), manifest);
        assert.equal(await readFile(join(fixture.sessionDir, "normalized", "session.flac"), "utf8"), "synthetic lossless audio");
      } finally { await rm(fixture.transcribeDir, { recursive: true, force: true }); }
    }
  }
});

test("legacy archive falls back to corrected transcript but never raw transcript", async () => {
  const fixture = await makeLegacyArchiveFixture({ includeReconciled: false, includeCorrected: true });
  const outputDir = join(fixture.transcribeDir, "output");
  await mkdir(outputDir, { recursive: true });
  try {
    const destination = await archiveSession({
      context: archiveTestContext(),
      cwd: fixture.transcribeDir,
      session: fixture.sessionDir,
      flags: {},
      settings: { transcribeDir: fixture.transcribeDir, outputDir, compression: false, audioBitrate: "32k" },
      dependencies: { encodeToOpus: async ({ input, output }) => copyFile(input, output) },
    });
    const transcript = await readFile(join(destination, "reconciled_transcript.md"), "utf8");
    assert.match(transcript, /Corrected fallback preface/u);
    assert.match(transcript, /\[private conversation redacted\]/u);
    assert.doesNotMatch(transcript, /RAW PRIVATE TRANSCRIPT/iu);
  } finally { await rm(fixture.transcribeDir, { recursive: true, force: true }); }
});

test("legacy archive rejects an empty reconciled transcript without falling back", async () => {
  const fixture = await makeLegacyArchiveFixture({ emptyReconciled: true, includeCorrected: true });
  const outputDir = join(fixture.transcribeDir, "output");
  await mkdir(outputDir, { recursive: true });
  try {
    await assert.rejects(
      () => archiveSession({
        context: archiveTestContext(), cwd: fixture.transcribeDir, session: fixture.sessionDir,
        flags: {}, settings: { transcribeDir: fixture.transcribeDir, outputDir, compression: false, audioBitrate: "32k" },
        dependencies: { encodeToOpus: async ({ input, output }) => copyFile(input, output) },
      }),
      /Selected final transcript is empty/iu,
    );
    assert.equal(await readdir(outputDir).then((entries) => entries.length), 0);
  } finally { await rm(fixture.transcribeDir, { recursive: true, force: true }); }
});

test("legacy archive fails closed when the reviewed manifest or final transcript is missing", async () => {
  const missingManifest = await makeLegacyArchiveFixture({ includeManifest: false });
  const missingManifestOutput = join(missingManifest.transcribeDir, "output");
  await mkdir(missingManifestOutput, { recursive: true });
  try {
    await assert.rejects(
      () => archiveSession({
        context: archiveTestContext(), cwd: missingManifest.transcribeDir, session: missingManifest.sessionDir,
        flags: {}, settings: { transcribeDir: missingManifest.transcribeDir, outputDir: missingManifestOutput, compression: false, audioBitrate: "32k" },
        dependencies: { encodeToOpus: async ({ input, output }) => copyFile(input, output) },
      }),
      /Missing required reviewed redactions\.yaml/iu,
    );
    assert.equal(await readdir(missingManifestOutput).then((entries) => entries.length), 0);
  } finally { await rm(missingManifest.transcribeDir, { recursive: true, force: true }); }

  const missingTranscript = await makeLegacyArchiveFixture({ includeReconciled: false, includeCorrected: false });
  const missingTranscriptOutput = join(missingTranscript.transcribeDir, "output");
  await mkdir(missingTranscriptOutput, { recursive: true });
  try {
    await assert.rejects(
      () => archiveSession({
        context: archiveTestContext(), cwd: missingTranscript.transcribeDir, session: missingTranscript.sessionDir,
        flags: {}, settings: { transcribeDir: missingTranscript.transcribeDir, outputDir: missingTranscriptOutput, compression: false, audioBitrate: "32k" },
        dependencies: { encodeToOpus: async ({ input, output }) => copyFile(input, output) },
      }),
      /Missing required final transcript/iu,
    );
    assert.equal(await readdir(missingTranscriptOutput).then((entries) => entries.length), 0);
  } finally { await rm(missingTranscript.transcribeDir, { recursive: true, force: true }); }
});

test("legacy archive fails closed when final transcript redaction applies no event", async () => {
  const fixture = await makeLegacyArchiveFixture({ failingRedaction: true });
  const outputDir = join(fixture.transcribeDir, "output");
  await mkdir(outputDir, { recursive: true });
  try {
    await assert.rejects(
      () => archiveSession({
        context: archiveTestContext(), cwd: fixture.transcribeDir, session: fixture.sessionDir,
        flags: {}, settings: { transcribeDir: fixture.transcribeDir, outputDir, compression: false, audioBitrate: "32k" },
        dependencies: { encodeToOpus: async ({ input, output }) => copyFile(input, output) },
      }),
      /matched no timestamped event/iu,
    );
    assert.equal(await readdir(outputDir).then((entries) => entries.length), 0);
  } finally { await rm(fixture.transcribeDir, { recursive: true, force: true }); }
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
