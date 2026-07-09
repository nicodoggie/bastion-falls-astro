# Terminology drift from loaded fandom/metaphysical terms

Use when a transcript/note cleanup has imported a plausible-sounding term from another setting or rules vocabulary, and Nico clarifies that Bastion Falls uses a more ordinary/descriptive term.

Example pattern from the Emerald Shield of Spring cleanup:

- Problem: note text used `sliver` / `elven slivers`, which could imply a Cosmere-like metaphysical category.
- Canon clarification: the relevant pieces are **shards of the Emerald Shield of Spring**; `shard` is descriptive of a shattered object, not a world-spanning metaphysical class.
- Source edits:
  - Replace the loaded term in the active authored note.
  - Add a compact clarifying note to the canonical artifact/item page if it is likely to be reused.
  - Remove resolved unresolved-hook bullets that kept the bad term alive.
- Correction rule:
  - Add a narrow `kind: entity` or concept rule only for the context where the drift is likely.
  - Include the rejected term in `aliases`.
  - Make the `instruction` explicitly say what the term is **not** so future models do not re-import the same external metaphysics.
  - Keep `apply.mode: prompt-first` and `safeExactReplacement: false` unless the surface form is truly safe everywhere.
- Validation:
  - Run `rumdl check` on edited MDX.
  - Parse/assert the new YAML rule, especially `canonical`, `aliases`, and the disambiguating instruction.
  - Run `astro sync` or the narrow package check that exercises the edited content.
