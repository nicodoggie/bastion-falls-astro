---
name: dnd-stat-block
description: >-
  Convert D&D 5e creature stat blocks into 5etools-style creature JSON under
  astro/src/content/docs/world, wire StatBlock in MDX, validate with
  CreatureDataSchema and yarn astro sync.
---

# D&D 5e stat block → `*.creature.json`

Use this skill when the user pastes or describes a **D&D 5th edition** creature
(stat block, bullet list, or MM-style prose) and wants it in the repo as data
for **`StatBlock.astro`**.

## Goals

1. Produce a **single JSON file** shaped like **5etools / bestiary creature
   data** (the project calls this **`CreatureData`**).
2. Place it where the **`creatures`** Astro collection can load it.
3. Optionally wire **`creatureStats`** in an MDX page and render
   **`<StatBlock creature={...} />`**.
4. Run **`yarn astro sync`** from **`astro/`** so Zod validates any
   **`creatureStats`** frontmatter that embeds or references the creature.

## Authoritative schema

- **Zod:** `CreatureDataSchema` from **`@bastion-falls/5e-schema-zod`**
  (generated from 5etools-utils bestiary JSON Schema).
- **Types:** infer from `packages/5e-schema-zod/src/generated/creature.ts` when
  you need exact keys (`trait`, `action`, `bonus`, `reaction`, `ac`, `hp`,
  `speed`, `save`, `skill`, etc.).
- **Frontmatter:** `astro/src/collection-schemas.ts` — `creatureStats` values
  may be a **string** (creatures collection id) or an **inline object** that
  must satisfy **`CreatureDataSchema`**.

Do **not** invent parallel shapes to satisfy **`StatBlock`**; extend
**`StatBlock`** if the UI is missing something the schema allows.

## File location and naming

- **Directory:** `astro/src/content/docs/world/` (any subfolder, e.g.
  `organizations/`, `misc/`, `species/`).
- **Filename:** `something.creature.json` (suffix **`.creature.json`**).
- **Collection id (for `StatBlock` and frontmatter):** path under `world/`
  **without** `.json`, e.g. file
  `organizations/eastonton-brigade-squire.creature.json` → id
  **`organizations/eastonton-brigade-squire.creature`**.

Defined in **`astro/src/content.config.ts`**: `creatures` collection uses
`generateId: ({ entry }) => entry.replace(/\.json$/, '')`.

## Step-by-step conversion

### 1. Normalize the source stat block

Extract explicitly (or infer clearly and note assumptions):

- Name, size, type line, alignment
- AC (and armor or special source), HP average and formula, speeds
- Ability scores (six numbers)
- Saving throws (if any), skills, damage vuln/resist/immune, condition
  immunities
- Senses, passive Perception, languages, **CR** (and XP if you set `cr` as an
  object with `xp` — optional)
- Traits, actions, **bonus actions**, reactions, legendary / lair (rare for
  custom NPCs)

If the paste mixes **“Features”** and **“Actions”**, map each named ability to
the correct **5etools bucket** (next section).

### 2. Map sections to JSON arrays

| Stat block section                                    | JSON key        | Shape                                          |
| ----------------------------------------------------- | --------------- | ---------------------------------------------- |
| Passive traits, spell lists as prose, senses-as-trait | **`trait`**     | `[{ "name": "...", "entries": ["...", ...] }]` |
| Actions (attacks, spell “actions”)                    | **`action`**    | same                                           |
| Bonus actions, recharge bonus powers                  | **`bonus`**     | same                                           |
| Reactions                                             | **`reaction`**  | same                                           |
| Legendary                                             | **`legendary`** | same (optional `legendaryActions`, headers)    |

Each feature: **`name`** (string), **`entries`** (array of strings — one
paragraph or bullet per string is fine; **`StatBlock`** joins them for display).

**Spellcasting:** `StatBlock` does **not** read a top-level **`spellcasting`**
array. Put **Pact Magic / Spellcasting** text (cantrips, slots, DC, attack
bonus) in a **`trait`** so it appears in the stat block.

**Conditional resistances** (e.g. “while raging”): avoid a top-level
**`resist`** if it would read as always-on; put the condition in **`trait`** or
**`bonus`** (rage) text so the printed block is not wrong.

### 3. Core field conventions (quick reference)

- **`name`:** creature name as shown on the block.
- **`size`:** array of codes, e.g. `["M"]` — `T|S|M|L|H|G` etc. (see
  **`SizeSchema`**).
- **`type`:** either a string or `{ "type": "humanoid", "tags": ["any race"] }`
  — tags may be strings or `{ "tag", "prefix" }` objects per schema.
- **`alignment`:** array of alignment codes, e.g. lawful good `["L","G"]`,
  neutral evil `["N","E"]`, chaotic neutral `["C","N"]`.
- **`ac`:** `[{ "ac": number, "from": ["plate"] }]` — optional **`condition`**,
  or **`{ "special": "..." }`** for unusual AC.
- **`hp`:** `{ "average": number, "formula": "8d8 + 16" }` — **`average`** must
  match the formula the table uses:
  - Mean = (count × die mean) + static modifier; die mean for **d8** is **4.5**.
  - **House rule for this repo:** when the mean is fractional, **round the total
    average up** (ceiling) so **`average`** is never below the intended
    “typical” HP (e.g. `13d8 + 52` → **111**).
- **`speed`:** `{ "walk": 30 }` — add **`fly`**, **`swim`**, etc. if needed.
- **`str` … `cha`:** integers (or `{ "special": "—" }` for undefined).
- **`save`:** `{ "wis": "+5", "cha": "+6" }` — bonuses as strings with `+`.
- **`skill`:** keys must match schema (`"animal handling"`, `"sleight of hand"`
  with spaces).
- **`passive`:** number for passive Perception; combine unusual senses in
  **`senses`** array if used.
- **`languages`:** string array.
- **`cr`:** string like `"3"` or `"1/2"`; or object with **`cr`**, **`xp`** per
  schema.

### 4. Actions and multiattack

- **`Multiattack`** is its own **`action`** entry; weapon entries follow.
- **Spell attacks / saves in actions:** full sentence strings in **`entries`**
  (same style as WotC stat blocks).

### 5. Validate and wire

1. **`yarn astro sync`** from **`astro/`** — fixes types and validates docs
   frontmatter against **`docsExtension`** (includes **`creatureStats`**).
2. If the creature is only referenced from MDX as a **string id**, the
   **`creatures`** entry still loads; strict **`CreatureDataSchema`** applies
   when the stat object is **inlined** in frontmatter.
3. **MDX wiring:**
   - Add to frontmatter:  
     `creatureStats:`  
     `  myKey: path/under/world/name.creature`  
     (no `.json`; path relative to `astro/src/content/docs/world`).
   - Import:  
     `import StatBlock from '../../../../components/StatBlock.astro'`  
     (adjust `../` depth from the MDX file to `astro/src/components/`).
   - Render:  
     `<StatBlock creature={frontmatter.creatureStats.myKey} />`

### 6. CR and encounter copy

- **`cr`** in JSON should match the **design intent** of the block; optional
  sanity check vs DMG offensive/defensive benchmarks (HP, AC, DPR, save DCs).
- Encounter prose (**tactics**, **composition**) lives in **MDX**, not in the
  JSON, unless you are storing pure narrative in a trait (usually avoid).

## Pitfalls (project-specific)

- **`creatureStats` must not** be implemented as a **separate glob collection**
  over **`*.creature.json`** with **`docsSchema`** — JSON would be validated as
  Starlight docs and require **`title`**, etc. In this repo, **`creatureStats`**
  is only on **`docsExtension`**, not a duplicate loader.

## Checklist before finishing

- [ ] **`*.creature.json`** under **`world/`** with valid **`CreatureData`**
      shape.
- [ ] **`hp.average`** agrees with **`hp.formula`** (rounded per house rule).
- [ ] Features sit in **`trait` / `action` / `bonus` / `reaction`** as
      appropriate for **`StatBlock`**.
- [ ] Spellcasting text is where **`StatBlock`** can show it (usually
      **`trait`**).
- [ ] **`yarn astro sync`** succeeds.
- [ ] MDX **`creatureStats`** keys and **`StatBlock`** import path are correct.

## Example references in-repo

- Minimal martial:  
  `astro/src/content/docs/world/organizations/eastonton-brigade-squire.creature.json`
- Full caster + bonus + reaction:  
  `astro/src/content/docs/world/organizations/eastonton-brigade-charmweaver.creature.json`
- Paladin-style leader:  
  `astro/src/content/docs/world/organizations/eastonton-brigade-divine-inquisitor.creature.json`

## Related: spells and magic items (same workflow)

The repo also supports **5etools `SpellData`** and **`ItemData`** as JSON with
**`SpellBlock.astro`** and **`ItemBlock.astro`**:

| Kind | Suffix | Astro collection | Frontmatter | Component |
|------|--------|------------------|-------------|-----------|
| Spell | `.spell.json` | `spells` | `spellStats` | `<SpellBlock spell={...} />` |
| Item | `.item.json` | `itemData` | `itemDataStats` | `<ItemBlock item={...} />` |

Schemas: **`SpellDataSchema`**, **`ItemDataSchema`** (`@bastion-falls/5e-schema-zod`).
Help page: `astro/src/content/docs/help/5e-tools-schema/spell-and-item.mdx`.
