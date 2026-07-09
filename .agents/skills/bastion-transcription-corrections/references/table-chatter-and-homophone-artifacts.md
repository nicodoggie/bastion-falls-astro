# Table Chatter and Homophone Artifacts

Use this pattern when a generated note turns casual table conversation into apparent lore, or when a small ASR homophone creates a fake unresolved entity.

## Trigger

- The note preserves a weird lore-like phrase that the user identifies as a simple mishearing, e.g. `creepy nana` -> `creepy nun`.
- Nearby food/object wording came from real-life table chatter, snacks, side talk, or jokes rather than the in-world scene.
- The generated note has an open hook based on that false premise.

## Workflow

1. Search the active note and same-date transcript for the suspect phrase and nearby topic words.
2. Patch authored notes directly:
   - Replace the fake phrase with the user-settled wording.
   - If the corrected wording points to a likely known entity, say `likely` unless the user fully confirms it.
   - Remove open hooks that only exist because of the artifact.
   - Preserve only a narrow confirmation hook when identity remains slightly uncertain.
3. Add or update shared correction rules:
   - Add the bad phrase as an alias to the likely known entity when future passes may repeat the same drift.
   - Add a session-scoped `rejected-as-artifact` / `table-chatter` rule for real-table side talk that should not become lore.
4. Keep real lore with similar vocabulary separate. For example, do not let charcuterie chatter erase actual Star Candies / auction-candy lore in other contexts.
5. Validate the edited note with `rumdl check` and run `git diff --check` for the touched files.

## Example

In the 2026-06-27 Vengeful notes:

- `creepy nana` was user-corrected to `creepy nun`, likely Lady Maribel Veyne.
- Parasite-hidden-in-treats wording was likely caused by out-of-game chatter about meats on a charcuterie board.
- The note was patched to say the church target includes a `creepy nun`, likely Lady Maribel Veyne.
- The parasite-food open hook was removed.
- `corrections.yaml` gained:
  - `creepy nana` / `creepy nun` aliases under `character.lady-maribel-veyne`.
  - A session-scoped `artifact.charcuterie-board-food-chatter` rule warning not to convert real-table food talk into in-world parasite clues.
