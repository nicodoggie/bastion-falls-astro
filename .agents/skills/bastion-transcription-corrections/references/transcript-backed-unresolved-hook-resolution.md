# Transcript-backed unresolved hook resolution

Use this when Nico resolves several bullets in an active campaign note and leaves one detail to verify from transcript context.

Pattern from the 2026-06-20 Castle Malthrek cleanup:

1. Patch user-settled facts directly in the active note, not as new uncertainty.
   - Example: Fagus was unconscious, captured, and bound; the party kept him alive to help clear Reformists from the Highbury barony.
   - Example: Fenwick remained blinded and magically/strongly restrained.
2. For the remaining uncertain detail, search the same-date corrected transcript first with narrow terms from the hook (`Greater Restoration`, `scroll`, character names, spell/item names).
3. Read enough surrounding transcript to determine who acted and what source is actually evidenced.
4. Write the note with calibrated confidence:
   - If the transcript confirms the actor but not the mechanism, say so.
   - Do not over-confirm an item/source just because the user suggested it might be true.
   - Example wording: "The transcript context points to Emily as the caster, apparently using a _Greater Restoration_ scroll or other limited casting source."
5. Remove only the unresolved bullets actually answered. Leave adjacent hooks that still require confirmation.
6. Validate the edited MDX with `rumdl check` for the note.

Why this matters: the corrected transcript can settle actor/sequence details even when the note summary stayed vague, but transcript wording may still be too messy to prove inventory mechanics such as whether the casting came from a scroll versus another limited source.
