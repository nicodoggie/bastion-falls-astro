# Session 2026-07-05 Correction Patterns

Compact example of promoting chunked correction notes into shared correction rules.

## Source shape

This session used `astro/.bf-transcripts/session-2026-07-05/correction_notes_chunks/session_*.md` rather than a single joined `correction_notes.md`. When this happens, scan the chunks in order and synthesize candidates instead of assuming there are no session notes.

## Promotions that worked

- **Greater Archon**: correction chunks had `Great Archon`/`Greater Archon` drift; the current note already said Emily is supposedly a `Greater Archon` and that the party does not understand the title. Promote as `status: provisional`, `kind: title`, `safeExactReplacement: false`.
- **Marad**: chunks repeatedly used `Marad`/`Merad`/`Dr. Marad`; the current note had `Marad` as a provisional Castle Malthrek servant recruiter and explicitly kept `Marad` distinct from `Marston`. Promote narrowly with `scope.sessionDates` and preserve the Marids/fish-people joke caveat.
- **Sabinia / Benya**: chunks flagged these as likely Tagalog `sabi niya` or ASR noise. Add as aliases to the existing `artifact.sabina` rule rather than creating a new character.
- **Dream Brew / Essence drift**: the note kept `Essence of Dream`, `Dream Brew`, `Essence of Sleep`, `Oil of Sleep`, and `Essence of Nymph` tangled-but-distinct, and explicitly rejected `Elixir of Dreams`. Add aliases/instruction to the existing `item.essence-of-dream` rule without collapsing distinct items.
- **Ranlis specificity**: update an existing broad `Count Ranlis` rule with article refs for `Godwin Ranlis` and `Aveline Ranlis` once those articles/notes exist, rather than spawning separate overlapping rules.

## Pitfall

Do not promote every uncertain name cluster. `Cyril`, `Selphie`, `Rizi/Rizzy`, `Sora`, `Namara`, `Isma`, `Likra/Licra`, `Preijen`, `Raja`, and similar names were left as audio-check/session-only until stronger evidence appears.
