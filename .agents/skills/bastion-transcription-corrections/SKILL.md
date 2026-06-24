---
name: bastion-transcription-corrections
description: Maintain Bastion Falls shared transcription correction rules. Use when the user corrects recurring mistranscriptions, asks to update bfcli transcribe corrections, wants a note-cleanup conversation converted into durable correction rules, or needs astro/.bf-transcripts/corrections.yaml updated from campaign notes, transcripts, or codex_notes.
---

# Bastion Transcription Corrections

## Purpose

Update `astro/.bf-transcripts/corrections.yaml` with reusable correction knowledge for `bfcli transcribe`. The goal is to reduce repeated correction sweeps while keeping note-local uncertainty out of global rules.

## Workflow

1. Read the target correction store first:
   - `astro/.bf-transcripts/corrections.yaml`
   - If it does not exist, create it with `version: 1` and `profiles.global.rules`.
2. Gather evidence from the current task:
   - Current conversation corrections.
   - The active note under `astro/src/content/docs/world/notes/...`.
   - Session-level correction notes such as `astro/.bf-transcripts/session-YYYY-MM-DD/correction_notes.md`.
   - Matching `.bf-transcripts/session-*/codex_notes/notes.mdx`, `scenes/*.md`, and `chunks/*.md` when present.
   - Canonical world articles named by the user.
3. Classify each correction:
   - Use `status: confirmed` only when the user explicitly settled the canon or a canonical article proves it.
   - Use `status: provisional` when a spelling or identity is likely but still depends on audio/context.
   - Use `status: rejected-as-artifact` when a transcript term should not become a lore entity.
4. Decide whether to update an existing rule:
   - Add new aliases to an existing entity rule when the same wrong form resolves to the same canonical target in the same context.
   - Add or update a `kind: disambiguation` rule when one surface form can mean multiple real entities.
   - Add a `kind: transcription-artifact` rule when a term should usually be ignored or treated as ASR/table noise.
5. Keep scope narrow enough:
   - Prefer `scope.campaigns` for campaign-specific names.
   - Add `scope.sessionDates` only when the rule is not safe across the whole campaign.
   - Put contextual limits in `scope.contexts` and the `instruction`.
6. Run the interactive Q&A workflow when session correction notes contain unresolved or low-confidence items.
7. Patch `corrections.yaml` directly, preserving human-readable order and comments if present.

## Session Correction Q&A

Use this workflow when a session has `correction_notes.md` or when the user is actively reviewing a note cleanup.

1. Read the session correction notes and extract candidate items into three groups:
   - **Promote candidates:** repeated or already-settled corrections that may belong in `corrections.yaml`.
   - **Session-only checks:** low-confidence timestamp/audio checks that should remain in the session notes.
   - **Do-not-promote artifacts:** jokes, one-off table noise, or unresolved guesses that would pollute future runs.
2. Ask concise questions only for promotion candidates that cannot be resolved from existing repo context.
   - Prefer one item or a small related batch per question.
   - Ask whether the correction is reusable, session-scoped, or should stay local.
   - Include the current observed term, likely canonical term, and evidence path/timestamp when available.
3. Do not ask about items that are clearly local or unresolved; leave those in `correction_notes.md`.
4. After the user answers:
   - Add confirmed reusable rules to `corrections.yaml`.
   - Add cautious `provisional` rules only when future runs will benefit and the scope is narrow.
   - Add `rejected-as-artifact` rules only for recurring artifacts likely to reappear.
5. Keep `correction_notes.md` as the session audit trail. Do not delete low-confidence notes just because a related shared rule exists.

Example Q&A prompt:

```text
I found "Sierra, a Sister of the Light" in the session notes. Should this be promoted as a reusable correction to Sierre Leveroux, kept session-local for this timestamp, or left unresolved?
```

## Rule Shape

Use this structure:

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
  scope:
    campaigns:
      - the-vengeful
  apply:
    mode: prompt-first
    safeExactReplacement: false
  instruction: >
    Tell transcription and notes models exactly how to use this correction.
  evidence:
    - path: astro/src/content/docs/world/notes/the-vengeful/2026-06-14.mdx
      note: Short reason this note supports the rule.
```

Required fields: `id`, `status`, `kind`, `canonical`, `aliases`, `scope`, `apply`, and `instruction`. Use `canonical: null` for rejected artifacts or pure disambiguation rules.

## Scope Rules

- Do not create a new rule ID for every bad spelling. Add aliases to the existing rule when the correction concept is the same.
- Do not globally replace context-sensitive names. Use `apply.mode: prompt-first` and `safeExactReplacement: false` for cases like `Marky`, `Talbito`, or `tawag dito`.
- Use `safeExactReplacement: true` only for exact misspellings that do not plausibly refer to another canon term.
- Keep transcript process notes out of generated narrative; correction rules should guide models, not appear in published notes.

## Common Bastion Patterns

- Character/entity misspelling: `Sensudine` -> `Sensodyne`; add aliases to the Sensodyne rule.
- Contextual split: `Marky` can mean Murky Mabrams in teasing/protective-suit contexts, but Mark Malthrek is also real; use a disambiguation rule.
- Rejected artifact: `Sabina` can be ASR/Taglish noise in Vengeful correction passages; do not invent a character unless later evidence changes this.
- Filler phrase: Tagalog `tawag dito` can be mistranscribed as lore-like names; do not canonize it as a place or person.

## Validation

After editing:

```bash
pnpm -F @bastion-falls/cli test
python3 /home/ensu/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/bastion-transcription-corrections
```

If the user is actively correcting a note, also run the relevant `rumdl check` for that note after any note edits. Do not stage `.bf-transcripts/` artifacts.
