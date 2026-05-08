---
name: dnd-item
description: >-
  Create a D&D 5e magic item as 5etools-style ItemData JSON with source "BF"
  under astro/src/content/docs/world/items as <item-slug>.item.json, prompting
  for any missing details.
---

# D&D 5e magic item → `world/items/*.item.json` (source: `BF`)

Use this skill when the user wants to add a **new D&D 5e magic item** to the
repo as **5etools ItemData JSON** consumed by `ItemBlock.astro`.

This skill must be able to work from:

- A complete item spec the user provides, or
- A partial spec, where you ask targeted questions to fill gaps.

## Goals

1. Produce a **single JSON file** shaped like **5etools `ItemData`**.
2. Ensure `"source": "BF"` (unless the user explicitly requests otherwise).
3. Place the file under:
   `astro/src/content/docs/world/items/<item-slug>.item.json`
4. Ensure the file passes `ItemDataSchema` validation.
5. Run `yarn astro sync` from `astro/` to validate the content collections.

## Authoritative schema + repo rules

- **Schema**: `ItemDataSchema` from `@bastion-falls/5e-schema-zod`
  (wired in `astro/src/content.config.ts` as the `itemData` collection schema).
- **Data files**: any `**/*.item.json` under `astro/src/content/docs/world/`
  are loaded by the `itemData` collection. This skill standardizes on
  `world/items/` for location.
- **Collection id**: path relative to `world/` without `.json`, e.g.:
  `items/potion-of-healing.item.json` → id `items/potion-of-healing.item`

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
- **value**: if provided in gp, convert to 5etools copper pieces:
  \(1\text{ gp} = 100\text{ cp}\). Example: 50 gp → `5000`.

## File naming (slug rules)

Create a filesystem-safe slug for the filename:

- lowercase
- spaces/punctuation → `-`
- collapse repeated `-`
- trim leading/trailing `-`

Filename must be exactly:

`astro/src/content/docs/world/items/<slug>.item.json`

## Building the JSON (`ItemData`)

### Minimal required shape (typical)

At minimum, most items should have:

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

If you can’t confidently map it, search existing `*.item.json` examples in the
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

- Run `yarn astro sync` from `astro/`.
- If validation fails, adjust the JSON to satisfy `ItemDataSchema` (do not
  weaken validation or add custom loaders).

## Checklist before finishing

- [ ] File created at `astro/src/content/docs/world/items/<slug>.item.json`
- [ ] `"source": "BF"` is present
- [ ] JSON validates under `ItemDataSchema`
- [ ] `yarn astro sync` succeeds

