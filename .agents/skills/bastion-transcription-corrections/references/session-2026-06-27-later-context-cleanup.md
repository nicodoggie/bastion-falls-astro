# Session 2026-06-27 Later-Context Cleanup Pattern

Use when a generated Vengeful campaign note still contains unresolved hooks or provisional ASR spellings that later notes, creature stats, or shared correction rules have already settled.

## Evidence Sources That Worked

- Active note: `astro/src/content/docs/world/notes/the-vengeful/2026-06-27.mdx`
- Shared rules: `astro/.bf-transcripts/corrections.yaml`
- Later adjacent notes:
  - `astro/src/content/docs/world/notes/the-vengeful/2026-06-28.mdx`
  - `astro/src/content/docs/world/notes/the-vengeful/2026-07-04.mdx`
- Canon/stat files:
  - `astro/src/content/docs/world/misc/father-karam-dunweather.creature.yaml`
  - `astro/src/content/docs/world/misc/lady-maribel-veyne-cupbearer.creature.yaml`

## Cleanup Moves

- Replace "audio-checkable" family uncertainty only when later notes explicitly resolve it.
  - Example: Baron Dunum Highbury is Dorothy/Miya's maternal grandfather and wants her as heir, but her legal status stays complicated.
- Use later creature stats to resolve Reformist mechanical labels without over-explaining table-facing unknowns.
  - `Appoint Vessel` -> `Appoint the Vessel`.
  - Father Karam Dunweather's charm immunity is preserved as a condition immunity.
  - Lady Maribel Veyne's title is singular `Bearer of the Cup`.
- Promote later-settled Legally Bare / sponsor spellings while keeping product details provisional.
  - `En Chanté Workshop`, `Warp Star Café`, `Darling's Atelier`, `Chaos Prism`, `Lollia and Pops`, `Love Beat`, `Strawberry Anal Trainer`.
- Promote later-settled persona/name spellings.
  - `Maerwen Lunartear`, `Cinna Moan`, `Puffy Pirika` / `Etopirika`.
- Clarify later-settled dream patron context without collapsing distinct identities.
  - Mami/Mommy is Queen Duarend, Queen of Dreams and Luana's archfey patron.
  - Keep mundane Luana, Princess Luwanya, and the Luana-like fey spirit distinct unless canon merges them.

## Pitfalls

- Do not delete an unresolved hook just because a related spelling is settled; narrow it to the remaining unknown.
- Do not turn table joke/product-review banter into formal item lore; settle names, not mechanics, unless a source file or later note proves mechanics.
- Do not add a global correction rule for every cleaned note-local phrase. Promote only recurring ASR drift or concepts likely to affect future transcription passes.

## Focused Validation

For note-only cleanup, a narrow validation is enough:

```bash
pnpm exec rumdl check astro/src/content/docs/world/notes/the-vengeful/2026-06-27.mdx
git diff --check -- astro/src/content/docs/world/notes/the-vengeful/2026-06-27.mdx
```
