# Crispin Mallow Character Article Implementation Plan

> **For Hermes:** Implement directly while preserving unrelated work in the dirty tree.

**Goal:** Add a canon-aware Crispin Mallow character article and relocate both rendered stat blocks
to it.

**Architecture:** Use one character MDX page as the narrative and encounter-statistics source. Keep
uncertain political and operational links explicitly unresolved while treating Nico's direct
clarifications as settled canon.

**Tech Stack:** Astro content collections, MDX, character frontmatter, and existing `StatBlock` YAML
references.

---

## Task 1: Create the character article

**Files:**

- Create: `astro/src/content/docs/world/characters/crispin-mallow.mdx`

**Steps:**

1. Add schema-compatible character metadata and relationships.
1. Write concise in-world sections covering his identity, Candlebearer role, draconic delusion,
   fleshcraft, Castle Malthrek activity, and unresolved operations.
1. Reference and render both existing Crispin creature YAML entries.

## Task 2: Move stat-block rendering

**Files:**

- Modify: `astro/src/content/docs/world/misc/maltreks-reformists.mdx`

**Steps:**

1. Remove both Crispin collection keys and rendered blocks.
1. Add a link directing readers to Crispin's character article and encounter statistics.

## Task 3: Validate

**Steps:**

1. Run rumdl on the article, Reformists page, design, and plan.
1. Run Astro content sync and the Astro build.
1. Confirm both stat blocks render on the character route and no longer render on the general page.
1. Inspect the scoped diff and do not commit unless requested.
