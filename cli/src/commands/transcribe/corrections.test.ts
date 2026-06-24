import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  defaultCorrectionsPath,
  filterCorrectionRules,
  loadCorrectionRulesMarkdown,
  parseCorrectionProfile,
  renderCorrectionRulesMarkdown,
} from "./corrections.js";

const sampleYaml = `
version: 1
profiles:
  global:
    rules:
      - id: character.sensodyne
        status: confirmed
        kind: entity
        canonical: Sensodyne
        canonicalRefs:
          - type: article
            path: astro/src/content/docs/world/characters/sensodyne.mdx
            role: primary
        aliases:
          - Sensudine
        scope:
          campaigns:
            - the-vengeful
        apply:
          mode: prompt-first
          safeExactReplacement: true
        instruction: Use Sensodyne for the devil crew member.
        evidence:
          - path: astro/src/content/docs/world/notes/the-vengeful/2026-06-06.mdx
      - id: character.other-campaign
        status: confirmed
        kind: entity
        canonical: Other
        aliases:
          - Othur
        scope:
          campaigns:
            - other-campaign
        apply:
          mode: prompt-first
        instruction: Do not include this in Vengeful runs.
`;

test("defaults shared correction rules to astro .bf-transcripts", () => {
  assert.equal(
    defaultCorrectionsPath("/repo"),
    "/repo/astro/.bf-transcripts/corrections.yaml",
  );
});

test("parses and filters correction rules by campaign", () => {
  const profile = parseCorrectionProfile(sampleYaml);
  const rules = filterCorrectionRules(profile, {
    campaign: "the-vengeful",
    sessionDate: "2026-06-21",
  });

  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.id, "character.sensodyne");
  assert.equal(rules[0]?.canonical, "Sensodyne");
});

test("renders correction rules with status, aliases, canonical refs, and instructions", () => {
  const profile = parseCorrectionProfile(sampleYaml);
  const markdown = renderCorrectionRulesMarkdown(filterCorrectionRules(profile, {
    campaign: "the-vengeful",
    sessionDate: "2026-06-21",
  }));

  assert.match(markdown, /# Shared Transcription Correction Rules/);
  assert.match(markdown, /character\.sensodyne/);
  assert.match(markdown, /Status: confirmed/);
  assert.match(markdown, /Aliases: Sensudine/);
  assert.match(markdown, /astro\/src\/content\/docs\/world\/characters\/sensodyne\.mdx/);
  assert.match(markdown, /Use Sensodyne for the devil crew member/);
});

test("loads no correction rules when the default file is missing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bf-corrections-missing-"));

  const markdown = await loadCorrectionRulesMarkdown({
    cwd,
    campaign: "the-vengeful",
    sessionDate: "2026-06-21",
  });

  assert.equal(markdown, "");
});

test("loads correction rules from an explicit path", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bf-corrections-explicit-"));
  const path = join(cwd, "corrections.yaml");
  await writeFile(path, sampleYaml, "utf8");

  const markdown = await loadCorrectionRulesMarkdown({
    cwd,
    path,
    campaign: "the-vengeful",
    sessionDate: "2026-06-21",
  });

  assert.match(markdown, /character\.sensodyne/);
  assert.doesNotMatch(markdown, /character\.other-campaign/);
});
