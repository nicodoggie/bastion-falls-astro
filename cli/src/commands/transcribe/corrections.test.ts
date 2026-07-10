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
        match:
          priority: high
          tags:
            - sensodyne
            - devil-crew
        scope:
          campaigns:
            - the-vengeful
        apply:
          mode: prompt-first
          safeExactReplacement: true
        promptInstruction: Use Sensodyne for the devil crew member.
        instruction: Use Sensodyne for the devil crew member. Longer audit-only taxonomy detail.
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
      - id: item.star-card
        status: confirmed
        kind: entity
        canonical: Star Card
        canonicalRefs:
          - type: item
            name: Star Card
            source: BMT
        scope:
          campaigns:
            - the-vengeful
        instruction: Use Star Card for the standalone card item.
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

	assert.equal(rules.length, 2);
	assert.equal(rules[0]?.id, "character.sensodyne");
	assert.equal(rules[0]?.canonical, "Sensodyne");
	assert.deepEqual(rules[0]?.match, {
		priority: "high",
		tags: ["sensodyne", "devil-crew"],
	});
	assert.equal(
		rules[0]?.promptInstruction,
		"Use Sensodyne for the devil crew member.",
	);
});

test("parses non-path canonical references from rules data", () => {
	const profile = parseCorrectionProfile(sampleYaml);
	const rules = filterCorrectionRules(profile, {
		campaign: "the-vengeful",
		sessionDate: "2026-06-21",
	});

	const starCard = rules.find((rule) => rule.id === "item.star-card");
	assert.deepEqual(starCard?.canonicalRefs, [
		{
			type: "item",
			name: "Star Card",
			source: "BMT",
		},
	]);
});

test("renders compact correction rules for normal prompts", () => {
	const profile = parseCorrectionProfile(sampleYaml);
	const markdown = renderCorrectionRulesMarkdown(
		filterCorrectionRules(profile, {
			campaign: "the-vengeful",
			sessionDate: "2026-06-21",
		}),
	);

	assert.match(markdown, /# Shared Transcription Correction Rules/);
	assert.match(markdown, /character\.sensodyne/);
	assert.match(markdown, /Status: confirmed/);
	assert.match(markdown, /Aliases: Sensudine/);
	assert.match(markdown, /Use Sensodyne for the devil crew member/);
	assert.match(markdown, /Match priority: high/);
	assert.match(markdown, /Tags: sensodyne, devil-crew/);
	assert.doesNotMatch(
		markdown,
		/astro\/src\/content\/docs\/world\/characters\/sensodyne\.mdx/,
	);
	assert.doesNotMatch(markdown, /Longer audit-only taxonomy detail/);
	assert.doesNotMatch(markdown, /Evidence/);
});

test("renders full correction rules for audit output", () => {
	const profile = parseCorrectionProfile(sampleYaml);
	const markdown = renderCorrectionRulesMarkdown(
		filterCorrectionRules(profile, {
			campaign: "the-vengeful",
			sessionDate: "2026-06-21",
		}),
		{ detail: "full" },
	);

	assert.match(
		markdown,
		/astro\/src\/content\/docs\/world\/characters\/sensodyne\.mdx/,
	);
	assert.match(markdown, /Longer audit-only taxonomy detail/);
	assert.match(markdown, /Evidence/);
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
