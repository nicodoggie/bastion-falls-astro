# User-settled unresolved hook batches

Use this pattern when Nico answers several `Unresolved Hooks` confirmation bullets in one message.

## Example: 2026-06-20 Vengeful note

Nico confirmed several Castle Malthrek/Fina hooks in a batch:

- Mountain near Castle Malthrek: `Mt. Thibris`.
- Hicklander food-house name: `Martha's food house`.
- Castle head chef: `Marjun`, shortened from `Marie-Jean`.
- Reformist titles:
  - `Cupbearer` is shorthand for `Bearer of the Cup`.
  - Whip title is primarily `Bearer of the Whip`; `Whip-bearer` and `Whiplaird` are acceptable variants.
- Fina: Proserfina Prunus Subhirtella, a changeling from the Feywild, Inkwell Academy researcher specializing in Fey Crossings, ruin explorer, adventured with Cotto, fell in love with him, and chose to come to his world.
- `Miss Narnaya` spelling should resolve to canonical `Narmaya`; polite form `Miss Narmaya` is acceptable.

## Workflow

1. Patch the active note directly:
   - Replace provisional wording with confirmed canon.
   - Remove the corresponding unresolved hook bullets.
   - Keep nearby unresolved bullets that were not answered.
2. Update canonical articles when the hook answer provides stable article-worthy facts:
   - Example: Fina's character page changed species to `changeling` and gained a short in-world intro.
   - Do not over-expand beyond the user's supplied facts unless article expansion is explicitly requested.
3. Add or update shared correction rules in `astro/.bf-transcripts/corrections.yaml`:
   - Create narrow, campaign-scoped rules for reusable spellings/titles/entities.
   - Include canonical article refs when available.
   - Use `safeExactReplacement: false` for context-sensitive titles or names.
4. Validate:
   - `pnpm exec rumdl check <edited-mdx>`
   - YAML parse/assert for new correction rule IDs.
   - `pnpm -F @bastion-falls/astro astro sync` when article frontmatter/schema changes.
   - `pnpm -F @bastion-falls/cli test` when correction-rule behavior or CLI-facing assumptions changed substantially.

## Pitfalls

- Do not leave already-confirmed hook bullets in `Unresolved Hooks`.
- Do not create a correction rule for every one-off line; promote only facts likely to recur in transcripts/notes.
- Do not flatten formal/shorthand title distinctions. Preserve both when Nico distinguishes them.
- When a canonical article proves a spelling (e.g. `Narmaya`), use it as the correction rule's primary reference.
