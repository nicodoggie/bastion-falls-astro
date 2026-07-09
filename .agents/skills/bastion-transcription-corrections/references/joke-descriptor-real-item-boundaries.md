# Joke Descriptor vs Real Item Boundaries

Use this when table banter or ASR gives an item a joke name, but the conversation or Nico clarifies that a real item/event is underneath it.

## Pattern

1. Search the active note, corrected transcript, raw transcript, and shared correction rules for the joke phrase and nearby canonical terms.
2. Preserve the real underlying thing in the authored note with a neutral canonical placeholder when the formal name is unknown, e.g. `unnamed arousal-inducing orb`.
3. Explicitly quarantine the joke phrasing as a descriptor/alias, not the formal item name.
4. Add the negative boundary that prevents future conflation with nearby canon, e.g. `not one of the Orbs of Power`.
5. If the source/donor is known but not named, record that precisely (`taken from a Reformist-aligned character in Raibon; donor name not documented`) rather than inventing a name.
6. Add a narrow `prompt-first` correction rule so future transcript/note models do not either discard the item as table banter or canonize the joke name.
7. Keep evidence paths/timestamps in the rule and validate both the edited MDX note and `corrections.yaml`.

## Example: 2026-06-27 unnamed arousal orb

Transcript evidence used phrases like `Orb of Horny`, `orb that makes you horny`, and `orbs that make you horny` around the same scene. Nico clarified that this was an actual orb item taken from a Reformist-aligned character in Raibon, but the donor's name and formal item name were not documented.

The note should therefore say the real item exists as an `unnamed arousal-inducing orb`, not an `Orb of Horny`, and should explicitly separate it from Orbs of Power lore. The shared rule should include the joke phrases as aliases only, with instructions not to discard the underlying item as pure banter.