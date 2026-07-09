# Disguise / Cover Identity Corrections

Use when Nico clarifies that a named person in a generated note is actually a disguise, cover identity, alternate form, or persona of an already-known character.

## Pattern

1. Patch the active authored note so the cover identity is introduced as the known character's disguise, not as an unresolved separate entity.
   - Good: `Sister Rachel is Emily Hazeldine's Reformist disguise.`
   - Avoid: `Rachel or Emily`, `Rachel/Emily?`, or wording that keeps the identity split open after Nico settled it.
2. Sweep the rest of the note for carried-forward ambiguity:
   - replace vague pairings like `Rachel or Emily` with a stable form such as `Emily / Sister Rachel`;
   - update section headings and unresolved hooks that preserve the old uncertainty;
   - keep the cover name when it matters diegetically, but anchor it to the true character.
3. Add or update a narrow shared correction rule in `astro/.bf-transcripts/corrections.yaml` when future note/transcription passes may re-split the identity.
   - Use `kind: character` or `kind: disambiguation` depending on the existing rule shape.
   - Include aliases for the cover name and the casual short form.
   - In `instruction`, explicitly say the cover name is a disguise/persona of the canonical character in the scoped context.
4. Validate both edited surfaces:
   - `pnpm exec rumdl check <active-note>`
   - `git diff --check -- <active-note> astro/.bf-transcripts/corrections.yaml`

## Example

For the Castle Malthrek infiltration, Nico clarified that `Sister Rachel` / `Rachel` is Emily Hazeldine's Reformist disguise. The note should say that directly and use `Emily / Sister Rachel` for the ongoing Greater Archon bluff instead of preserving `Rachel or Emily` as an open question.
