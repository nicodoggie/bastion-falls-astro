# MDX linking and YAML/flavor split

Session learning from adding the Love Beat item.

## User preference

When an item page mentions in-world entities, the first meaningful mention should point readers
to the existing canon entry when one exists. For rules/data entities, prefer inline tags/components
over plain prose.

## Apply when creating or updating item MDX

- Keep `*.item.yaml` focused on rules/effects that belong in the ItemBlock.
- Move most lore, manufacturer context, table/canon notes, and narrative framing into the companion
  `.mdx` article.
- Link the first meaningful prose mention of in-world organizations, families, factions, locations,
  and characters to their MDX pages if present.
- Use inline tags/components for spells, items, creatures, etc. when the site supports them:
  - `<Spell name="detect magic" src="phb" />`
  - `<Item name="Variable Cock Sheath" src="BF" />`
- Prefer lowercase canonical source IDs for core books in tags, e.g. `src="phb"`.
- Do not over-link repeated mentions; first useful mention is enough.
- Keep standalone utility items independent of compatible special-case items. Document a
  compatibility link on the specialized item's side rather than making the general tool's
  article or rules depend on it; a revealing pen need not name every ink it can reveal.

## Rendering and draft verification

- Keep ItemData entry strings plain unless raw 5etools tags were explicitly requested.
  `ItemBlock` does not render Markdown emphasis in YAML strings: `**Curse.**`
  appears with literal asterisks. Use plain section labels, not Markdown markup.
- Run the YAML ESLint formatter on only the new item files. Its block-scalar
  rule requires canonical wrapping at 100 columns, not merely lines shorter
  than that limit. Compare parsed entries before and after formatting.
- A successful production build does not prove a `draft: true` item page
  rendered: Starlight excludes those routes from production. Exercise draft
  pages through an Astro development server and verify their `ItemBlock`
  content, while retaining draft status. Validate the ItemData files directly
  as well as running `astro sync`.

## Example shape

```mdx
A **Love Beat** is associated with [Legally Bare](../organizations/legally-bare.mdx)'s adult novelty line.

The magic is noticeable when spells like <Spell name="detect magic" src="phb" /> or similar are used.

The Love Beat is distinct from the <Item name="Variable Cock Sheath" src="BF" />.
```
