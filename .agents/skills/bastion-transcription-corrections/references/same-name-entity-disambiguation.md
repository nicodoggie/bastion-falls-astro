# Same-Name Entity Disambiguation: Henson Eastonton vs Henson the Golem

Use this when a note/transcript pass has collapsed two canon entities because they share a surface name.

## Pattern

- Treat same-name collisions as a disambiguation problem, not a simple replacement.
- Search active notes and nearby same-campaign notes for both full names and role phrases.
- Patch authored notes to use full disambiguating names where ambiguity matters.
- If a shared correction rule exists, make it `kind: disambiguation` or otherwise explicitly warn future agents not to merge the entities.
- Preserve joke/misnaming forms only as contextual jokes, not as additional lore entities.

## Session example

In the 2026-06-27 Vengeful note cleanup, generated notes incorrectly treated **Henson the Golem** as **Henson Eastonton in stone golem form**.

Correct canon:

- **Henson Eastonton** is a separate person, Boyle Eastonton's nephew.
- **Henson the Golem** is the stone golem Miya hijacked from a trap while cutting off potential Reformist reinforcements.
- **Henderson** can be preserved only as a joke/misnaming form when the dialogue is explicitly joking.

Required cleanup steps used:

1. Patch the active note wherever it says or implies Henson Eastonton is the golem.
2. Search follow-up notes for carried-forward drift such as `Henson Eastonton in stone golem form`.
3. Patch shared corrections so future note generation disambiguates the two instead of force-replacing `Henson the Golem` with `Henson Eastonton`.
4. Validate the edited MDX notes with `rumdl check`, then run correction YAML / CLI validation when shared corrections changed.
