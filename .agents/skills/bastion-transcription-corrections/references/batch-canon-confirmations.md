# Batch canon confirmations pattern

Use this when Nico replies to several unresolved-hook questions in one message and the answers are reusable canon/correction guidance.

## Example: Castle Malthrek / 2026-06-20

Nico confirmed, in one batch:

- Mountain near Castle Malthrek: `Mt. Thibris`.
- Hicklander food-house name: `Martha's food house`.
- Chef name: `Marjun`, shortened from `Marie-Jean`; do not preserve `Marijon` uncertainty in the castle-head-chef context.
- Reformist titles:
  - `Cupbearer` is shorthand for `Bearer of the Cup`.
  - Whip title is primarily `Bearer of the Whip`; `Whip-bearer` and `Whiplaird` are acceptable variants.
- Fina: `Proserfina Prunus Subhirtella`, a changeling from the Feywild. She adventured with Cotto and others there, fell in love with Cotto, and chose to come to Cotto's world.

## Workflow

1. Patch the active note directly:
   - Replace provisional/uncertain phrasing with confirmed wording.
   - Remove only the now-resolved hooks from `## Unresolved Hooks`.
   - Keep unrelated unresolved hooks intact.
2. Patch canonical articles when the confirmation changes a character/place/item truth, not just the session note.
   - In the example, Fina's page changed `species: human` to `species: changeling` and gained a short Feywild/Cotto intro.
3. Add or update shared correction rules when the confirmation is likely to recur in transcript cleanup:
   - place/name rules for geography and people (`place.mt-thibris`, `character.marjun`).
   - terminology rule for hierarchy/title variants (`reformist.bearer-titles`).
   - entity rule when an alias/backstory clarification prevents future unresolved hooks (`character.proserfina-prunus-subhirtella`).
4. Validate:
   - `pnpm exec rumdl check <edited-mdx-files>`
   - Parse `astro/.bf-transcripts/corrections.yaml` and assert the new rule IDs exist.
   - Run `pnpm -F @bastion-falls/astro astro sync` when content frontmatter/schema changed.
   - Run `pnpm -F @bastion-falls/cli test` when correction-rule behavior/data is touched.

## Pitfalls

- Do not turn a batch answer into a new one-session skill. Keep it under this shared transcription/canon-correction workflow.
- Do not over-remove unresolved hooks. If Nico did not answer it, leave it.
- Do not treat title shorthand as a separate office unless Nico says so; encode shorthand/variant relationships in the rule instruction.
- If a confirmation directly contradicts a stub article's frontmatter, update the article too; otherwise future generated summaries will resurrect the old fact.
