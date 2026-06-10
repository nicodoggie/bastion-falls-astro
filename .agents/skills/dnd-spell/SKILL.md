---
name: dnd-spell
description: >-
  Create a D&D 5e spell as 5etools-style SpellData YAML with source "BF" under
  astro/src/content/docs/world/spells as <spell-slug>.spell.yaml, prompting for
  any missing details.
---

# D&D 5e spell → `world/spells/*.spell.yaml` (source: `BF`)

Use this skill when the user wants to add a **new D&D 5e spell** to the repo as
**5etools-shaped `SpellData` YAML** consumed by `SpellBlock.astro`.

This skill must be able to work from:

- A complete spell spec the user provides, or
- A partial spec, where you ask targeted questions to fill gaps.

## Goals

1. Produce a **single YAML file** shaped like **5etools `SpellData`**.
1. Ensure `"source": "BF"` (unless the user explicitly requests otherwise).
1. Place the file under:
   `astro/src/content/docs/world/spells/<spell-slug>.spell.yaml`
1. Ensure the file passes `SpellDataSchema` validation.
1. Run `pnpm astro sync` from `astro/` to validate the content collections.

## Authoritative schema + repo rules

- **Schema**: `SpellDataSchema` from `@bastion-falls/5e-schema-zod`
  (wired in `astro/src/content.config.ts` as the `spells` collection schema).
- **Data files**: any `**/*.spell.{yaml,yml,json}` under
  `astro/src/content/docs/world/` are loaded by the `spells` collection. This
  skill standardizes on `world/spells/` and **YAML by default**; write JSON only
  if the user explicitly asks.
- **Collection id**: path relative to `world/` without `.yaml`, `.yml`, or
  `.json`, e.g.:
  `spells/fire-bolt.spell.yaml` → id `spells/fire-bolt.spell`

Help reference: `astro/src/content/docs/help/5e-tools-schema/spell-and-item.mdx`

## When details are missing: ask these questions

If the user didn’t supply a field, ask for it. If they say “whatever makes
sense”, use the defaults in the next section and document assumptions in the
chat response (not in code comments).

### Identity and classification

- Spell name (exact printed name)
- Spell level (0–9), and whether it’s a cantrip
- School of magic (5e): **Abjuration, Conjuration, Divination, Enchantment,
  Evocation, Illusion, Necromancy, Transmutation**
- Is it a ritual?
- Which classes/subclasses can cast it?

### Casting + targeting

- Casting time (action/bonus action/reaction/minute/hour; any trigger)
- Range (self/touch/feet/miles; point/line/cone/sphere/cylinder/cube; any
  area-of-effect size)
- Components:
  - Verbal / Somatic
  - Material (exact text) and whether it’s consumed / has a gp cost
- Targets (creature/object/point; number of targets; willing/unwilling)

### Duration + concentration

- Duration (instant, rounds/minutes/hours/days, until dispelled, special)
- Does it require concentration?

### Rules text

- Primary effect (damage/healing/control/summon/utility), including scaling
  at higher levels or cantrip scaling
- Attack roll or saving throw?
  - Save ability, and what happens on a successful save
- Conditions applied, movement, summons, or persistent effects
- Any limitations, drawbacks, or special clauses

## Defaults and conventions (use when user is undecided)

- **source**: `"BF"`
- **classes**: omit unless the user cares (many homebrew spells are world-/
  setting-specific). If asked, default to a small set that makes sense.
- **entries**: write rules text as plain readable sentences (avoid raw 5etools
  `{@tag}` syntax unless the user explicitly wants it).
- If the user provides “range: 60 ft” and no shape, assume a **point** range.

## File naming (slug rules)

Create a filesystem-safe slug for the filename:

- lowercase
- spaces/punctuation → `-`
- collapse repeated `-`
- trim leading/trailing `-`

Filename must be exactly:

`astro/src/content/docs/world/spells/<slug>.spell.yaml`

## Building the YAML (`SpellData`)

Use the schema as the source of truth. Prefer the simplest schema-valid
representation.

### Common core fields (typical)

Most spells will include:

- `name` (string)
- `source` (string, `"BF"`)
- `level` (number 0–9)
- `school` (string code per 5etools; map from the 5e school name)
- `time` (array; usually one entry with `number` and `unit`)
- `range` (object; point/self/touch/area)
- `components` (object; `v`, `s`, `m` as needed)
- `duration` (array; instant/timed/special; include concentration when needed)
- `entries` (array of strings / entry blocks)

### School mapping

Map the user’s 5e school name to the 5etools `school` code:

- Abjuration → `A`
- Conjuration → `C`
- Divination → `D`
- Enchantment → `E`
- Evocation → `V`
- Illusion → `I`
- Necromancy → `N`
- Transmutation → `T`

### Entries

`entries` is the primary display body for `SpellBlock.astro`. Include:

- One paragraph for the base effect.
- Additional paragraph(s) for scaling (e.g. “At Higher Levels…”, or cantrip
  scaling milestones).

If the spell has higher-level scaling, prefer `entriesHigherLevel` if the
schema expects it; otherwise include scaling text in `entries` (the UI handles
both).

## Validation

After writing the file:

- Run `pnpm astro sync` from `astro/`.
- If validation fails, adjust the YAML data to satisfy `SpellDataSchema` (do not
  weaken validation or add custom loaders).

## Checklist before finishing

- [ ] File created at `astro/src/content/docs/world/spells/<slug>.spell.yaml`
- [ ] `"source": "BF"` is present
- [ ] YAML spell data validates under `SpellDataSchema`
- [ ] `pnpm astro sync` succeeds
