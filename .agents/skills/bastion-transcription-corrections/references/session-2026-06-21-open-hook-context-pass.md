# Session 2026-06-21 Open-Hook Context Pass

Use this pattern when a generated campaign note has an oversized `Open Hooks` list and the user asks to compare it against previous-session context first.

## What happened

The 2026-06-21 Vengeful note had unresolved hooks that were already answered by 2026-06-14 and 2026-06-20 notes or by current character/item articles. The cleanup was intentionally conservative: update the active note with settled continuity, remove only resolved hooks, and preserve genuinely uncertain mechanics.

## Useful evidence paths

- `astro/src/content/docs/world/notes/the-vengeful/2026-06-14.mdx`
  - Reformist hierarchy: Torward as Bearer of the Sword, Fenwick as Bearer of the Whip, Crispin Mallow as Candle Bearer, Dunweather shielding Orthodox/Reformist structures.
- `astro/src/content/docs/world/notes/the-vengeful/2026-06-20.mdx`
  - Highbury/Dorothy context: Baron Dunum Highbury, Charlotte Highbury, Dorothy Marie Campbell/Miya/Dorothy Highbury, Torch, Fagus, Fenwick, _Greater Restoration_ aftermath.
- `astro/src/content/docs/world/characters/dorothy-campbell.mdx`
  - Dorothy/Miya parentage and Highbury relationship.
- `astro/src/content/docs/world/characters/benoit-marconne.mdx`
  - Benoit Marconne alias Camden Dubreuil and Dubreuil cousin context.
- `astro/src/content/docs/world/characters/luana-victorique-dubreuil.mdx`
  - Luana’s Benoit cousin relationship.
- `astro/src/content/docs/world/characters/emily-hazeldine.mdx`
  - Periapt of Wound Closure context when a note says only “wound amulet.”

## Edit pattern

1. Read the active note’s local section and open hooks.
2. Search/read immediately prior same-campaign notes before changing canon.
3. Use current character/item articles to verify already-canonized relationships and aliases.
4. Patch nearby narrative bullets with wording like “later confirmed” or “earlier context identifies” when the active scene had not settled the fact yet.
5. Remove only the open-hook bullets that the evidence actually resolves.
6. Narrow broad hooks instead of deleting them when later work is still needed.
   - Example: replace “Decide how Henson can move through the city” with “Confirm whether Kelthyr’s water-overflow sewer pipe route works…”
7. Validate with focused markdown checks such as:

```bash
pnpm exec rumdl check astro/src/content/docs/world/notes/the-vengeful/2026-06-21.mdx
git diff --check -- astro/src/content/docs/world/notes/the-vengeful/2026-06-21.mdx
```

## Pitfalls

- Do not erase uncertainty just because a later article is more detailed; phrase chronology carefully if the party only learns it later.
- Do not promote every resolved hook to shared corrections. Many are note-local canon cleanup, not reusable transcription rules.
- Fix small generated-note grammar while touching the section, but keep the pass scoped.
