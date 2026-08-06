# Sebastian Argras Canonization Implementation Plan

> **For Hermes:** Implement these content tasks directly; no commit unless Nico explicitly requests
> one.

**Goal:** Canonize Sebastian Argras as House Rannek's seneschal, preserve Angel's informal “Butler”
address, and prevent his crisis-time coordination with court wizards from being misread as
wizardhood.

**Architecture:** Add one compact character article as the canonical source, link it from the Rannek
household and August 2 note, then propagate the settled office and boundary through generated
support material and the correction store. Preserve raw ASR and unresolved crisis details.

**Tech Stack:** Astro MDX content, YAML correction rules, `rumdl`, `mdsf`, pnpm/Node tests.

---

## Task 1: Create Sebastian's canonical article

**Objective:** Establish Sebastian's office and the limited meaning of Angel's “Butler” usage.

**Files:**

- Create: `astro/src/content/docs/world/characters/sebastian-argras.mdx`

**Steps:**

1. Add character frontmatter with House of Rannek membership and the position `Seneschal`.
1. Add concise in-world sections for his office, Angel's familiar address, and the Castle Rannek
   crisis.
1. Avoid unsupported age, ancestry, magical ability, duties, personality, or fate.

### Task 2: Link and reconcile authored canon

**Objective:** Make the new article discoverable and remove stale formal-butler language.

**Files:**

- Modify: `astro/src/content/docs/world/notes/the-vengeful/threads/rannek-marches.mdx`
- Modify: `astro/src/content/docs/world/notes/the-vengeful/2026-08-02.mdx`
- Modify: `astro/src/content/docs/world/characters/angel-rannek.mdx` if a concise relationship
  mention fits.

**Steps:**

1. Replace the `Butlers` roster classification with a household-officer entry for Sebastian as
   seneschal.
1. Link Sebastian's first August 2 mention to his article.
1. State that only Angel calls him “Butler,” as imprecise domestic shorthand that may carry
   affection.
1. State explicitly that Sebastian is not a court wizard.

### Task 3: Propagate and verify the canon boundary

**Objective:** Prevent generated notes from reintroducing the stale role or wizard interpretation.

**Files:**

- Modify: `astro/.bf-transcripts/corrections.yaml`
- Modify: relevant non-raw August 2 support artifacts under
  `astro/.bf-transcripts/session-2026-08-02/`

**Steps:**

1. Add or update a scoped correction rule for Sebastian Argras.
1. Replace support claims identifying him formally as a butler or court wizard with `seneschal` and
   the Angel-specific address boundary.
1. Preserve quoted dialogue and raw ASR where “Sebastian and the other court wizards” occurs;
   annotate its interpretation rather than inventing different spoken words.
1. Run `rumdl`, `mdsf`, YAML duplicate-ID validation, CLI tests, content synchronization/build
   checks, stale-role searches, raw-preservation checks, and `git diff --check`.
