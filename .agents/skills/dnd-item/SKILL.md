---
name: dnd-item
description: >-
  Create a D&D 5e magic item as 5etools-style ItemData YAML with source "BF"
  under astro/src/content/docs/world/items as [item-slug].item.yaml, add or
  update a companion [item-slug].mdx that wires itemDataStats + ItemBlock, and
  prompt for any missing details.
---

# D&D 5e magic item → `world/items/[slug].item.yaml` + `[slug].mdx` (source: `BF`)

Use this skill when the user wants to add a **new D&D 5e magic item** to the
repo as **5etools-shaped ItemData YAML** consumed by `ItemBlock.astro`.

This skill must be able to work from:

- A complete item spec the user provides, or
- A partial spec, where you ask targeted questions to fill gaps.

## Goals

1. Produce a **single YAML file** shaped like **5etools `ItemData`**.
1. Ensure `"source": "BF"` (unless the user explicitly requests otherwise).
1. Include a top-level **`"$schema"`** property as the first key:
   `"https://raw.githubusercontent.com/TheGiddyLimit/5etools-utils/master/schema/brew/items.json#/$defs/itemData"`
1. Place the file under:
   `astro/src/content/docs/world/items/<item-slug>.item.yaml`
1. Ensure the file passes `ItemDataSchema` validation.
1. **Companion MDX** (same slug, no `.item`):
   - Path: `astro/src/content/docs/world/items/<item-slug>.mdx`
   - **If it does not exist**: create it with Starlight frontmatter, optional
     `item` metadata (`ItemSchema` from `@bastion-falls/types`—mirror name,
     rarity, type, attunement, weight, value from the data file where helpful),
     **`itemDataStats`** with at least one key whose value is the **`itemData`**
     collection id: `items/<item-slug>.item` (path under `world/` without
     `.yaml`; same rule as `potion-of-healing.item.yaml` →
     `items/potion-of-healing.item`).
   - **If it already exists**: do not replace the whole article; **add or
     correct** `itemDataStats` so one entry points at `items/<item-slug>.item`,
     and ensure the page renders that data (e.g.
     `<ItemBlock item={frontmatter.itemDataStats.<key>} />`). Prefer **one**
     conventional key such as `rules` or `statBlock` for new pages.
   - Import: from `world/items/*.mdx`, use
     `import ItemBlock from '../../../../components/ItemBlock.astro';`
1. Run `pnpm astro sync` from `astro/` to validate the content collections.

When other docs (e.g. lore articles) embed the same item, they may link to this
MDX page instead of duplicating `ItemBlock`, unless a second embed is
deliberate.

## Authoritative schema + repo rules

- **Schema**: `ItemDataSchema` from `@bastion-falls/5e-schema-zod` (wired in
  `astro/src/content.config.ts` as the `itemData` collection schema).
- **Data files**: any `**/*.item.{yaml,yml,json}` under
  `astro/src/content/docs/world/` are loaded by the `itemData` collection. This
  skill standardizes on `world/items/` and **YAML by default**; write JSON only
  if the user explicitly asks.
- **Collection id**: path relative to `world/` without `.yaml`, `.yml`, or
  `.json`, e.g.:
  `items/potion-of-healing.item.yaml` → id `items/potion-of-healing.item`

Help reference: `astro/src/content/docs/help/5e-tools-schema/spell-and-item.mdx`

## When details are missing: ask these questions

If the user didn’t supply a field, ask for it. If they say “whatever makes
sense”, use the defaults in the next section and document assumptions in the
chat response (not in code comments).

### Identity and presentation

- Item name (exact printed name)
- Short description / lore (1–3 sentences) to incorporate into `entries`
- Is this meant to mirror an existing 5e item? If yes, which one?

### Rules and mechanics

- Item category/type (weapon, armor, shield, potion, ring, wondrous item,
  scroll, staff, wand, rod, ammo, tool, vehicle, etc.)
- Rarity (common/uncommon/rare/very rare/legendary/artifact/varies)
- Attunement:
  - Does it require attunement? Any prerequisites (class, alignment, etc.)?
- Charges / limited uses:
  - Charges count, recharge rules (dawn/dusk/long rest), and how expended
- Activation:
  - Action/bonus action/reaction/minute/etc. and any triggers
- Mechanical effects:
  - What it does (numerical bonuses, spell effects, conditions, damage, saves)
  - Save DC and/or attack bonus, if relevant
- Limitations and drawbacks:
  - Curses, side effects, exhaustion, risk, or “once per X” caps

### Economics and physical stats (optional but nice)

- Weight (if meaningful)
- Value/price guidance (gp), or “priceless”
- Whether it is consumable (e.g. potion/scroll/ammo)

## Defaults and conventions (use when user is undecided)

- **source**: `"BF"`
- **rarity**: `"uncommon"` for a typical campaign magic item
- **attunement**: required for strong passive bonuses or repeatable powers
- **entries**: write rules text as plain readable sentences (no `{@tag}` unless
  the user specifically wants raw 5etools tags)
- **value**: if provided in gp, convert to 5etools copper pieces: \(1\text{ gp}
  = 100\text{ cp}\). Example: 50 gp → `5000`.

## File naming (slug rules)

Create a filesystem-safe slug for the filename:

- lowercase
- spaces/punctuation → `-`
- collapse repeated `-`
- trim leading/trailing `-`

Filename must be exactly:

`astro/src/content/docs/world/items/<slug>.item.yaml`

## Building the YAML (`ItemData`)

### Minimal required shape (typical)

At minimum, most items should have:

- `$schema` (exact public 5etools itemData schema URL above)
- `name` (string)
- `source` (string, `"BF"`)
- `type` (string code per 5etools, e.g. `"P"` for potion)
- `rarity` (string)
- `entries` (array of strings / entry blocks)

Use the schema as the source of truth. If you’re unsure about a field, prefer
the simplest schema-valid representation.

### Choose an item `type`

Prefer standard 5etools item type codes when known. If the user gives a plain
English type, map it to a 5etools type code that `ItemDataSchema` accepts.

If you can’t confidently map it, search existing `*.item.yaml` examples in the
repo and mirror the closest match.

### Entries

`entries` is the primary display body for `ItemBlock.astro`. Put the complete
rules text here:

- Start with a short flavor sentence (optional).
- Then include clear mechanics:
  - activation and duration
  - ranges/areas
  - rolls, DCs, and scaling
  - limitations, costs, drawbacks

## Validation

After writing the file:

- Run `pnpm astro sync` from `astro/`.
- If validation fails, adjust the YAML data to satisfy `ItemDataSchema` (do not
  weaken validation or add custom loaders).

## Checklist before finishing

- [ ] File created at `astro/src/content/docs/world/items/<slug>.item.yaml`
- [ ] `"$schema"` is the first key and points at the public 5etools
      `brew/items.json#/$defs/itemData` schema URL
- [ ] `"source": "BF"` is present
- [ ] YAML data validates under `ItemDataSchema`
- [ ] Companion `astro/src/content/docs/world/items/<slug>.mdx` exists (new or
      updated) with `itemDataStats` → `items/<slug>.item` and `ItemBlock` (or
      equivalent wiring)
- [ ] `pnpm astro sync` succeeds
