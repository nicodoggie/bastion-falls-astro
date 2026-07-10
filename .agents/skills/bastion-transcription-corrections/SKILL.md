---
name: bastion-transcription-corrections
description: Maintain Bastion Falls shared transcription correction rules. Use when the user corrects recurring mistranscriptions, asks to update bfcli transcribe corrections, wants a note-cleanup conversation converted into durable correction rules, or needs astro/.bf-transcripts/corrections.yaml updated from campaign notes, transcripts, or codex_notes.
---

# Bastion Transcription Corrections

## Purpose

Update `astro/.bf-transcripts/corrections.yaml` with reusable correction knowledge for
`bfcli transcribe`. The goal is to reduce repeated correction sweeps while keeping note-local
uncertainty out of global rules.

## Workflow

Tone: Bastion Falls is Nico's hobby/worldbuilding playground, not work-work. Keep interaction
casual, curious, and lightly playful while still being precise about canon and file edits.

1. Consider read-only delegation for broad correction/reconciliation passes:
   - Use `delegate_task` when the task has 2+ independent evidence axes, such as many Open Hooks,
     multiple disputed names, or item/mechanics plus character/faction carry-forward checks.
   - Keep subagents read-only by default. Split by axis (names/places; items/spells/mechanics;
     characters/factions/canon carry-forward), then have the parent synthesize, patch, and validate.
   - Do not delegate trivial single-rule edits, one-file lookups, or checks where each step depends
     tightly on the previous result.
1. Read the target correction store first:
   - `astro/.bf-transcripts/corrections.yaml`
   - If it does not exist, create it with `version: 1` and `profiles.global.rules`.
1. Gather evidence from the current task:
   - Current conversation corrections.
   - The active note under `astro/src/content/docs/world/notes/...`.
   - Earlier summaries and notes from the same session or campaign, especially when they provide
     continuity for identities, titles, family links, or recurring artifacts.
   - Session-level correction notes such as
     `astro/.bf-transcripts/session-YYYY-MM-DD/correction_notes.md`.
   - Chunked correction notes such as
     `astro/.bf-transcripts/session-YYYY-MM-DD/correction_notes_chunks/session_*.md`. When there is
     no joined `correction_notes.md`, scan these chunks and synthesize promote/session-only/artifact
     candidates yourself.
   - Matching `.bf-transcripts/session-*/codex_notes/notes.mdx`, `scenes/*.md`, and `chunks/*.md`
     when present.
   - Public transcript assets for the same date, especially
     `astro/src/assets/transcripts/session-YYYY-MM-DD/corrected_transcript.md` and
     `raw_transcript.md`, when checking a heard spelling, timestamp, or uncertain phrase.
   - Canonical world articles named by the user.
   - If repo startup instructions point at missing legacy files such as `AGENTS.personality.md`, do
     not keep following the dead pointer; update `AGENTS.md` to the current Hermes-era workflow when
     the user asks to fix it.
1. Use continuity before canonizing uncertainty:
   - Compare suspect phrases against earlier summaries before treating them as new lore; a phrase
     may be a summarization drift from a known status, relationship, or title.
   - Prefer continuity-supported interpretations when multiple summaries point to the same entity,
     but keep audio-dependent details provisional unless the user or a canonical article settles
     them.
   - When continuity shows a phrase is just a distorted version of a known concept, record that in
     the rule instruction or evidence note.
1. Classify each correction:
   - Use `status: confirmed` only when the user explicitly settled the canon or a canonical article
     proves it.
   - Use `status: provisional` when a spelling or identity is likely but still depends on
     audio/context.
   - Use `status: rejected-as-artifact` when a transcript term should not become a lore entity.
1. Decide whether to update an existing rule:
   - Add new aliases to an existing entity rule when the same wrong form resolves to the same
     canonical target in the same context.
   - Add or update a `kind: disambiguation` rule when one surface form can mean multiple real
     entities.
   - Add a `kind: transcription-artifact` rule when a term should usually be ignored or treated as
     ASR/table noise.
1. Keep scope narrow enough:
   - Prefer `scope.campaigns` for campaign-specific names.
   - Add `scope.sessionDates` only when the rule is not safe across the whole campaign.
   - Put contextual limits in `scope.contexts` and the `instruction`.
1. Run the interactive Q&A workflow when session correction notes contain unresolved or
   low-confidence items.
1. Patch `corrections.yaml` directly, preserving human-readable order and comments if present.
1. When reporting changed or source transcript locations during an ACP/Zed session, use Markdown links with absolute local paths and line anchors, not GitHub URLs, code blocks, or bare path lists. Example: `[corrected_transcript.md:838](/home/ensu/Projects/bastion-falls-astro/astro/src/assets/transcripts/session-2026-06-21/corrected_transcript.md#L838)`.

## Session Correction Q&A

Use this workflow when a session has `correction_notes.md` or when the user is actively reviewing a
note cleanup.

1. Read the session correction notes and extract candidate items into three groups:
   - **Promote candidates:** repeated or already-settled corrections that may belong in
     `corrections.yaml`.
   - **Session-only checks:** low-confidence timestamp/audio checks that should remain in the
     session notes.
   - **Do-not-promote artifacts:** jokes, one-off table noise, or unresolved guesses that would
     pollute future runs.
1. Ask concise questions only for promotion candidates that cannot be resolved from existing repo
   context.
   - Prefer one item or a small related batch per question.
   - Ask whether the correction is reusable, session-scoped, or should stay local.
   - Include the current observed term, likely canonical term, and evidence path/timestamp when
     available.
1. Do not ask about items that are clearly local or unresolved; leave those in
   `correction_notes.md`.
1. After the user answers:
   - Add confirmed reusable rules to `corrections.yaml`.
   - Add cautious `provisional` rules only when future runs will benefit and the scope is narrow.
   - Add `rejected-as-artifact` rules only for recurring artifacts likely to reappear.
1. Keep `correction_notes.md` as the session audit trail. Do not delete low-confidence notes just
   because a related shared rule exists.

Example Q&A prompt:

```text
I found "Sierra, a Sister of the Light" in the session notes. Should this be promoted as a reusable correction to Sierre Leveroux, kept session-local for this timestamp, or left unresolved?
```

## Rule Shape

Use this retrieval-friendly structure for new or substantially revised rules:

```yaml
- id: character.example
  status: confirmed
  kind: entity
  canonical: Example Name
  canonicalRefs:
    - type: article
      path: astro/src/content/docs/world/characters/example-name.mdx
      role: primary
  aliases:
    - Misheard Name
  match:
    priority: normal
    tags:
      - example-name
      - relevant-place-or-thread
  scope:
    campaigns:
      - the-vengeful
    # Quote dates so js-yaml does not parse them as Date objects.
    sessionDates:
      - "2026-06-14"
  apply:
    mode: prompt-first
    safeExactReplacement: false
  promptInstruction: >
    Compact correction guidance for normal transcript/note prompts.
  instruction: >
    Longer human-readable nuance and audit guidance. Keep this useful, but do
    not make prompt-critical behavior depend only on this field.
  evidence:
    - path: astro/src/content/docs/world/notes/the-vengeful/2026-06-14.mdx
      note: Short reason this note supports the rule.
```

Required fields: `id`, `status`, `kind`, `canonical`, `aliases`, `scope`, `apply`, and
`instruction`. Use `canonical: null` for rejected artifacts or pure disambiguation rules.
For compact-prompt compatibility, add `promptInstruction` whenever `instruction` is long,
contains multiple canon boundaries, or includes audit-only detail.

### Matching and prompt-shape guidelines

- Treat `corrections.yaml` as the git-tracked canonical rule store. Do not move these rules into
  Hermes memory or a separate database; any runtime index should be generated in memory from this YAML.
- Add `match.tags` as retrieval hints for semantic context that aliases will not catch: places,
  factions, items, session threads, roles, spell names, and recurring scene labels.
- Use `match.priority` to control normal prompt inclusion:
  - `always` — tiny, broadly applicable, high-value rules that should always be injected for matching campaigns.
  - `high` — include when the campaign/session matches and any alias, canonical term, tag, or context appears.
  - `normal` — include only on a meaningful alias/canonical/tag/context match.
  - `low` — include only on direct or strong contextual match; good for open-hook guardrails and rare drift.
  - `archive` — keep as audit/evidence, but do not inject into normal prompts unless explicitly requested.
- Keep `promptInstruction` short: usually 1-3 sentences, model-facing, and directly actionable.
- Keep `instruction` human-readable and nuanced, but avoid essay-like entries. If a rule needs many
  paragraphs, split durable canon into articles/notes and keep the correction rule as an index card.
- Evidence is for audit/debug modes, not normal prompts. Do not rely on evidence notes to steer the model.
- Avoid path-like fake evidence such as `path: user correction`; prefer a real note/transcript path,
  `url`, or typed external reference with `name`/`source`.
- Quote `scope.sessionDates` values (`"2026-07-04"`) so the TypeScript loader receives strings,
  not YAML timestamp objects.
- Rules with no aliases are suspicious in this file. Keep them only if `match.tags` and
  `promptInstruction` make them useful for retrieval; otherwise the fact likely belongs in a note,
  article, or open-hook trail.

## Scope Rules

- Do not create a new rule ID for every bad spelling. Add aliases to the existing rule when the
  correction concept is the same.
- Do not globally replace context-sensitive names. Use `apply.mode: prompt-first` and
  `safeExactReplacement: false` for cases like `Marky`, `Talbito`, or `tawag dito`.
- Use `safeExactReplacement: true` only for exact misspellings that do not plausibly refer to
  another canon term.
- Keep transcript process notes out of generated narrative; correction rules should guide models,
  not appear in published notes.

## Common Bastion Patterns

See these compact references for worked patterns:

- `references/session-2026-07-05-correction-patterns.md` — promoting chunked correction-note
  findings into shared rules.
- `references/provisional-place-audio-checks.md` — checking an uncertain place name against note,
  codex, corrected transcript, raw transcript, and canonical articles.
- `references/iterative-note-review-corrections.md` — line-by-line review where Nico settles small
  generated-note errors that may require patching the active note, corrected transcripts, and shared
  correction rules.
- `references/table-chatter-and-homophone-artifacts.md` — ASR homophones or real-life table chatter
  creating fake lore hooks.
- `references/merchandise-lore-vs-side-jokes.md` — one confirmed product, VIP, or merchandise idea
  surrounded by side-joke debris that should not become lore.
- `references/terminology-drift-from-fandom-terms.md` — loaded terms that should be replaced by
  ordinary Bastion Falls wording.
- `references/canonical-spelling-sweeps.md` — user-settled proper-name spellings across notes,
  corrected transcripts, and shared correction rules.
- `references/disguise-cover-identity-corrections.md` — named people that are actually disguises,
  cover identities, alternate forms, or personas of existing characters.

- Canonical spelling sweep: when Nico says `X should be Y` for a proper name, search authored notes
  and public `corrected_transcript.md` assets for the rejected spelling, patch each occurrence that
  is the same entity, leave `raw_transcript.md` untouched as source evidence, and add or update a
  narrow shared correction rule. Use `safeExactReplacement: true` only for unambiguous spelling
  drift; otherwise prefer a prompt-first contextual rule.
- Disguise / cover identity correction: when Nico clarifies that a named person is actually a
  disguise, cover identity, alternate form, or persona of an existing character, rewrite the active
  note to introduce that relationship directly, sweep out `X or Y` ambiguity, update any unresolved
  hooks that preserved the split, and add a narrow shared correction rule so future passes do not
  re-split the identity. See `references/disguise-cover-identity-corrections.md` for the Sister
  Rachel / Emily Hazeldine pattern.
- Terminology drift from other settings: when Nico rejects a term because it implies imported
  metaphysics or fandom baggage, update the active note and add a narrow correction rule. Put the
  rejected term in `aliases`, but make the `instruction` explicitly say what the canonical term does
  **not** mean, so future transcription/notes models do not recreate the same external lore
  implication.
- Provisional place/name audio check: if a name appears only in note/codex/transcript evidence and
  the support trail labels it unresolved, report it as the current transcript spelling, not hard
  canon; use wording like "heard as X" or keep it in unresolved hooks.
- User-settled place canon: when Nico explicitly settles an unresolved heard place name, promote it
  to `status: confirmed`, add a narrow place rule with aliases for transcript variants, remove the
  term from unresolved hooks, and update the note/support trail so future correction sweeps stop
  re-asking the same question. See `references/user-settled-place-canon.md` for the Mt Brissimis
  pattern. If the settled form reveals the heard spelling was a phonetic/table rendering of a canon
  place or joke etymology, also update directly implicated location/cross-reference articles and
  retain the heard spelling only as an alias; see
  `references/phonetic-place-etymology-corrections.md`.
- User-settled unresolved hook batches: when Nico answers multiple unresolved hook bullets at once,
  patch the active note, remove only the answered unresolved bullets, update any stable canonical
  article facts, and add narrow reusable correction rules for recurring spellings/titles/entities.
  See `references/user-settled-unresolved-hook-batch.md` for the Castle Malthrek / Fina pattern.
- Transcript-backed unresolved hook resolution: when Nico settles some hooks but asks for transcript
  context on one remaining detail, search/read the same-date corrected transcript around the exact
  spell, item, and character names; canonize only what the transcript proves and phrase mechanism
  details cautiously if the actor is clear but the source item is not. See
  `references/transcript-backed-unresolved-hook-resolution.md` for the Highbury _Greater Restoration_
  pattern.
- Prior/later-context open-hook pruning: when a generated note has open hooks that may already be
  answered by same-campaign notes, shared correction rules, creature stats, or current articles,
  compare those sources before asking Nico. Patch the active note with chronology-aware wording like
  "earlier context identifies," "later context identifies," or "later creature stats preserve," and
  remove only hooks the evidence truly resolves. See
  `references/session-2026-06-21-open-hook-context-pass.md` for the 2026-06-21
  Highbury/Miya/Reformist-title cleanup pattern and
  `references/session-2026-06-27-later-context-cleanup.md` for the 2026-06-27 Legally Bare,
  Luana/Mommy, and Reformist stat cleanup pattern.
- Mechanics and player-request correction: when Nico clarifies a loose table mechanic or separates a
  special player-requested arc beat from the reusable convention, patch the note and add a narrow
  `kind: mechanics-note` correction rule. Preserve both the firm part and the fact that the DM may
  refine the mechanic later. See `references/mechanics-and-player-request-corrections.md` for the
  pregnancy/twins roll pattern.
- Magic item open-hook resolution: when Nico identifies an unresolved item hook, replace vague item
  descriptions with exact `<Item>` components and source codes, verify against 5etools when useful,
  preserve campaign-specific broken/hidden-function state, and narrow rather than delete repair
  hooks. Add shared correction rules for recurring aliases or misspellings. See
  `references/magic-item-open-hook-resolution.md` for the Star Card and Gold Canary Figurine pattern.
- Business/sponsor location correction: when Nico clarifies a named café, shop, sponsor, owner,
  advertiser, location, or student/customer base, patch the active note from vague generated wording
  into the settled facts, check directly implicated sponsor/organization articles for stale or typoed
  relationship wording, and add a narrow `kind: business`/`kind: organization` correction rule when
  future ASR or note passes may drift. See `references/business-sponsor-location-corrections.md` for
  the Warp Star Café / Tressemer Academy / Legally Bare pattern.
- Item mechanics and creative spell-shaping hook resolution: when Nico corrects a generated note's
  uncertainty about a known item or spell use, read the item's current MDX/YAML source and replace
  vague mechanics with exact mechanics, then narrow unresolved hooks to only truly open questions.
  For creative `<Spell name="summon fey" src="tce" />` shaping, distinguish a summoned spirit given
  someone's appearance from the person themself. If later scenes keep merging the lookalike spirit
  back into the real person, patch the active note at each carried-forward confusion point and
  strengthen both the person/entity rule and the spell/item rule; use wording like `mundane Luana`
  versus `Luana-like fey spirit`, and explicitly say the spirit is not the person's astral self,
  younger self, disguise, or transformed body. When a garbled name appears in a spell explanation,
  check whether it is ASR drift for an existing place before labeling it a fake entity; for example,
  `Rubana`/`Rebun` in the 2026-06-21 scene was Raibon in a Raibon-vs-Senera fey-crossing explanation,
  not a new character or place. Add correction rules for recurring interpretation mistakes as well
  as bad spellings. See `references/item-mechanics-and-spell-shaping-hook-resolution.md` for the
  Essence of Nymph / Lime Summon Fey pattern,
  `references/lookalike-summoned-spirit-identity-boundaries.md` for recurring mundane-person versus
  lookalike-spirit confusion, `references/joke-descriptor-real-item-boundaries.md` for cases where a
  joke/table-banter item name hides a real unnamed item, and `references/raibon-summon-fey-asr-drift.md`
  for the Rubana/Rebun -> Raibon correction pattern.
- ASR artifact source-link checks: when a name-like transcript artifact may be a misheard canon term
  and Nico wants to listen himself, search both corrected and raw transcripts, read a small timestamp
  window, and provide exact timestamp plus GitHub line links rather than over-canonizing the text
  artifact. Keep the correction rule scoped as ASR drift unless Nico confirms the heard term. See
  `references/asr-artifact-source-link-checks.md` for the Rubana/Rebun/Raibon pattern.
- Table chatter and homophone artifacts: when Nico identifies a weird lore hook as a simple mishearing
  or real-life table chatter, patch the active note to the corrected phrase, remove open hooks based
  only on the artifact, add the bad phrase as a narrow alias to the likely entity when useful, and
  add a session-scoped `table-chatter` rejected-artifact rule when food/object side talk could be
  promoted into false lore. See `references/table-chatter-and-homophone-artifacts.md` for the
  `creepy nana` -> `creepy nun` / charcuterie-board pattern.
- Merchandise lore vs side-joke debris: when Nico confirms one product/business/VIP thread as real
  while dismissing nearby horny, spooky, possession, or cleanup chatter, preserve the confirmed
  merchandise anchor in the active note and shared organization/product correction rule, then state
  the rejected side talk as an explicit boundary: ignore unless later scenes revive it as lore. See
  `references/merchandise-lore-vs-side-jokes.md` for the Legally Bare VIP doll/bag-charm pattern.
- User-settled spelling plus unknown-status hooks: when Nico resolves a name spelling and clarifies
  that a status is unknown (for example, exile before a discovery means parasite status is unknown),
  update the canonical article, direct cross-reference pages, the active note, and a narrow
  correction rule. The rule should include common spelling drift aliases and explicitly preserve the
  unknown status so future note/transcription passes do not over-resolve it as confirmed positive or
  confirmed negative. Remove only the resolved hook from unresolved lists.
- Character/entity misspelling: `Sensudine` -> `Sensodyne`; add aliases to the Sensodyne rule.
  When batch canon confirmations touch active notes, canonical articles, and shared correction
  rules, remove only the resolved hooks, keep unrelated uncertainties, and validate both MDX and the
  correction YAML. See `references/batch-canon-confirmations.md` for the 2026-06-20 Castle Malthrek
  pattern.
- Generic role resolution: when Nico identifies a role phrase in an active note as a known character
  (for example, "the necromancer" -> Minfilia), update the authored note directly to the canonical
  name and nearby pronouns/references. Only promote this to `corrections.yaml` if the role phrase is
  recurring or ambiguous enough to mislead future transcription runs; otherwise keep it as a
  note-local canon cleanup.
- Speaker and same-name entity corrections: when Nico corrects who said a line, who thanked whom, or
  which of two same-name entities a scene meant, search the active note and same-date corrected
  transcript. Patch the authored note and, when the transcript preserves the same error, patch the
  transcript speaker tag or use a full disambiguating name there too. Prefer full names in ambiguous
  later social contexts, e.g. `Henson Eastonton` vs `Henson the Golem`. If the issue is a same-name
  collision between two real entities, treat it as disambiguation rather than replacement: update
  shared correction rules so future passes do not merge the entities, and search follow-up notes for
  carried-forward drift. See `references/session-2026-06-27-speaker-entity-corrections.md` and
  `references/same-name-entity-disambiguation.md`.
- Contextual split: `Marky` can mean Murky Mabrams in teasing/protective-suit contexts, but Mark
  Malthrek is also real; use a disambiguation rule.
- Speaker-direction correction: when a short exchange is reversed, read the surrounding transcript
  line and use adjacency clues like direct address, `you're welcome`, and possessives. Patch the
  authored note and the transcript speaker tag when the tag itself is wrong; treat it as note-local
  unless the reversal recurs. See `references/speaker-direction-and-thanks-corrections.md`.
- Rejected artifact: `Sabina` can be ASR/Taglish noise in Vengeful correction passages; do not
  invent a character unless later evidence changes this. Related `Sabinia`/`Benya` shapes may be
  Tagalog `sabi niya` drift.
- Filler phrase: Tagalog `tawag dito` can be mistranscribed as lore-like names; do not canonize it
  as a place or person.
- Sleep/dream item drift: keep `Essence of Dream`, `Dream Brew`, `Essence of Sleep`, `Oil of
  Sleep`, and `Essence of Nymph` distinct unless canon explicitly merges them. Treat `Elixir of
  Dreams` as likely drift when notes reject it.
- Titles can be provisional corrections: e.g. prefer `Greater Archon` over `Great Archon` when the
  note context says the title exists but the party does not yet understand it.
- Wild Magic surge summaries should prioritize the narrative effects over roll numbers. If the
  transcript does not state the effect cleanly, infer likely effects from
  `astro/src/content/docs/world/misc/wild-magic.mdx` and reconcile them with the narrative instead
  of preserving raw roll bookkeeping.

## Validation

After editing:

```bash
pnpm -F @bastion-falls/cli test
python3 /home/ensu/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/bastion-transcription-corrections
```

If the user is actively correcting a note, also run the relevant `rumdl check` for that note after
any note edits. Do not stage per-session `.bf-transcripts/session-*` artifacts; the shared
`astro/.bf-transcripts/corrections.yaml` rule store is source-like and may be committed when it is
part of the requested durable correction.
