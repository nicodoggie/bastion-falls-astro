# Item Mechanics and Spell-Shaping Hook Resolution

Use this pattern when Nico corrects a generated campaign note that treated a known item, spell, or summoned manifestation as uncertain lore.

## Pattern

1. Start from the authored source of truth, not the generated note wording:
   - Magic item/article page, e.g. `astro/src/content/docs/world/items/...`.
   - Homebrew YAML/source data when present.
   - 5e spell/component metadata when the note should render a standard spell component.
2. Replace vague mechanics with exact current mechanics from the source page.
   - Preserve important safety/consent clauses exactly enough that future summaries do not imply compulsion.
   - Keep remaining uncertainty narrow: e.g. recreation, transformation physiology, or later consequences.
3. For creative spell use, distinguish the spell effect from the apparent identity.
   - If a caster shapes a `summon fey` spirit to resemble a known person or court figure, say it is a different summoned spirit in that appearance, not the person themselves and not a trapped/local spirit, unless canon says otherwise.
   - Render the spell with the normal component form (`<Spell name="summon fey" src="tce" />`) when editing MDX notes.
4. Update `corrections.yaml` so future transcript/note passes avoid rebuilding the same uncertainty.
   - Add item rules that point to both MDX and YAML sources when available.
   - Add spell-use/disambiguation rules for recurring interpretation mistakes, not just bad spellings.
5. Validate both layers:
   - `pnpm exec rumdl check <active-note.mdx>` for the note.
   - `git diff --check -- astro/.bf-transcripts/corrections.yaml <active-note.mdx>` for whitespace/diff sanity.

## Example: 2026-06-21 Vengeful cleanup

- `Essence of Nymph` was linked to the item article and rewritten with exact mechanics: DC 15 Wisdom save, charmed/aroused/nymph-like outlook for `1d6` hours, hourly repeat saves, long-rest benefit for the affected creature and one willing intimate partner when the effect ends, exhaustion reduction, and explicit non-compulsion.
- Open hooks were narrowed to whether the vial can be recreated and how lycanthropy/wild transformations/unusual physiology interact with it.
- Lime's Arcadia-like and Luana-like manifestations were clarified as creative `<Spell name="summon fey" src="tce" />` shaping: not Arcadia, not Luana, and not trapped local spirits.
- Shared correction rules were added for the item and for creative Summon Fey shaping so future notes do not reintroduce the old uncertainty.