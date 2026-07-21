# Crispin Mallow Two-Phase Stat Blocks Implementation Plan

> **For Hermes:** Implement each task directly and preserve unrelated work in the dirty tree.

**Goal:** Produce and render two schema-valid creature YAML files for Crispin's humanoid
fleshcrafter phase and counterfeit gold-dragon phase.

**Architecture:** Keep each phase as an independent creatures-collection entry. Phase one names the
transition to phase two; phase two contains the progressive Graft Rejection weakness that degrades
its CR 17 combat profile toward CR 14.

**Tech Stack:** YAML creature data validated by `CreatureDataSchema`, Astro content collections,
MDX, 5etools inline tags.

---

## Task 1: Rewrite Crispin's humanoid phase

**Files:**

- Modify: `astro/src/content/docs/world/misc/crispin-mallow-candlebearer.creature.yaml`

**Steps:**

1. Preserve the CR 11 humanoid chassis where it still supports the encounter.
1. Replace generic candle attacks with Borrowed Face, Anatomist's Sight, flesh-golem creation and
   command, limb exchange, detached-limb control, and the 0-hit-point phase transition.
1. Keep spellcasting focused on disguise, control, transformation, and surgical utility.
1. Read back the complete YAML and check hit-point and damage averages.

### Task 2: Add the Gilded Anatomy phase

**Files:**

- Create: `astro/src/content/docs/world/misc/crispin-mallow-gilded-anatomy.creature.yaml`

**Steps:**

1. Add a Huge CR 17 monstrosity with counterfeit gold-dragon movement, breath, attacks, and
   legendary actions.
1. Add three-step Graft Rejection caused by restorative magic or removal of the infernal piercing.
1. Make each Rejection's cumulative mechanical consequences explicit in the trait text.
1. Check the intact and fully rejected action economy against the CR 17/14 design targets.

### Task 3: Render the second phase

**Files:**

- Modify: `astro/src/content/docs/world/misc/maltreks-reformists.mdx`

**Steps:**

1. Add the Gilded Anatomy collection id to `creatureStats`.
1. Render the second block immediately after the Candlebearer block.

### Task 4: Validate

**Steps:**

1. Run `pnpm -C astro exec astro sync`.
1. Run focused YAML lint against both Crispin files.
1. Run rumdl against the touched MDX and design/plan documents.
1. Run `git diff --check` and inspect the scoped diff.
1. Do not stage or commit changes unless the user asks.
