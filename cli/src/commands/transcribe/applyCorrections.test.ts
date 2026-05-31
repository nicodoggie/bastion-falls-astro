import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAnnotatedCorrectionNotes,
  buildApplyAnnotatedCorrectionsPrompt,
  buildApplyCorrectionsPrompt,
  parseCorrectionBackend,
  normalizeCorrectionDecision,
  resolveEditorCommand,
  reviewedTranscriptionDirFor,
  type CorrectionDecision,
} from "./applyCorrections.js";

test("normalizes edited correction decisions into alias entries", () => {
  const decision = normalizeCorrectionDecision({
    action: "edit",
    original: "Sana Walbert",
    correction: "Isana Walburton",
    applyGlobally: true,
    note: "Confirmed by campaign canon.",
  });

  assert.deepEqual(decision, {
    action: "edit",
    original: "Sana Walbert",
    correction: "Isana Walburton",
    applyGlobally: true,
    note: "Confirmed by campaign canon.",
    alias: {
      from: "Sana Walbert",
      to: "Isana Walburton",
    },
  });
});

test("does not create aliases for skipped corrections", () => {
  const decision = normalizeCorrectionDecision({
    action: "skip",
    original: "Murak Room",
    note: "Unresolved.",
  });

  assert.equal(decision.alias, undefined);
});

test("builds second correction prompt with human decisions", () => {
  const decisions: CorrectionDecision[] = [
    normalizeCorrectionDecision({
      action: "edit",
      original: "Sana Walbert",
      correction: "Isana Walburton",
      applyGlobally: true,
    }),
  ];

  const prompt = buildApplyCorrectionsPrompt({
    glossary: "- Isana Walburton",
    rawTranscript: "[00:00:01 - 00:00:02] Sana Walbert",
    correctedTranscript: "[00:00:01 - 00:00:02] Sana Walbert",
    correctionNotes: "- Sana Walbert may be Isana Walburton",
    decisions,
  });

  assert.match(prompt, /Apply these human-reviewed correction decisions/);
  assert.match(prompt, /Sana Walbert/);
  assert.match(prompt, /Isana Walburton/);
});

test("builds an annotated correction notes template", () => {
  const annotated = buildAnnotatedCorrectionNotes("- Sana Walbert may be Isana Walburton");

  assert.match(annotated, /Annotation Instructions/);
  assert.match(annotated, /Sana Walbert/);
});

test("builds second correction prompt with annotated correction notes", () => {
  const prompt = buildApplyAnnotatedCorrectionsPrompt({
    glossary: "- Isana Walburton",
    rawTranscript: "[00:00:01 - 00:00:02] Sana Walbert",
    correctedTranscript: "[00:00:01 - 00:00:02] Sana Walbert",
    annotatedCorrectionNotes: "DECISION: Sana Walbert -> Isana Walburton",
  });

  assert.match(prompt, /Apply this annotated correction review/);
  assert.match(prompt, /DECISION: Sana Walbert -> Isana Walburton/);
});

test("only opens an editor when one is explicitly requested", () => {
  assert.equal(resolveEditorCommand(undefined, {}), undefined);
  assert.equal(resolveEditorCommand("", {}), undefined);
  assert.equal(resolveEditorCommand("zed --wait", { VISUAL: "nvim", EDITOR: "vim" }), "zed --wait");
});

test("uses VISUAL before EDITOR by default", () => {
  assert.equal(resolveEditorCommand(undefined, { VISUAL: "zed --wait", EDITOR: "vim" }), "zed --wait");
  assert.equal(resolveEditorCommand(undefined, { EDITOR: "vim" }), "vim");
});

test("parses supported correction backends", () => {
  assert.equal(parseCorrectionBackend("codex"), "codex");
  assert.equal(parseCorrectionBackend("ollama"), "ollama");
  assert.throws(() => parseCorrectionBackend("whisper"), /Unsupported correction backend/);
});

test("uses reviewed_transcription as the chunked reviewed output directory", () => {
  assert.equal(reviewedTranscriptionDirFor("/tmp/session1"), "/tmp/session1/reviewed_transcription");
});
