# Ramboys Provisional Article Implementation Plan

> **For Hermes:** Implement this plan directly as a small content-only change; preserve the user's
> dirty worktree and do not commit.

**Goal:** Add a concise in-world article capturing the presently established canon for *Ramboys*.

**Architecture:** Create one organization article following the existing *Nightshift Nurses* and
*Legally Bare* patterns, then link its first mention in the July 19 Vengeful note. Keep the
unapproved coded-trade idea explicitly separate from established publication practice.

**Tech Stack:** Astro content collections, MDX, rumdl, mdsf

---

## Task 1: Create the Ramboys article

**Objective:** Record the publication, readership, performer terminology, initial pairing, and
unapproved trade proposal without inventing missing details.

**Files:**

- Create: `astro/src/content/docs/world/organizations/ramboys.mdx`

**Step 1:** Add organization frontmatter with `Magazine` and `Ministry of Science` tags.

**Step 2:** Add concise in-world sections for purpose and audience, Models and Bottoms, and the
proposed coded trade.

**Step 3:** Read the article back and remove fourth-wall phrasing, invented dates, additional roster
members, and any implication that the trade proposal has publisher approval.

### Task 2: Link the July 19 note

**Objective:** Connect the active session note to the new canonical article.

**Files:**

- Modify: `astro/src/content/docs/world/notes/the-vengeful/2026-07-19.mdx`

**Step 1:** Link the first meaningful `Ramboys` mention to `../../organizations/ramboys.mdx`.

**Step 2:** Preserve all existing wording about the Herb of the Harem proposal and its unresolved
implementation.

### Task 3: Validate the content

**Objective:** Prove that the new page and edited note are structurally valid and cleanly formatted.

**Files:**

- Verify: `astro/src/content/docs/world/organizations/ramboys.mdx`
- Verify: `astro/src/content/docs/world/notes/the-vengeful/2026-07-19.mdx`

**Step 1:** Run `pnpm exec rumdl check -c .rumdl.toml` on both files; expect no issues.

**Step 2:** Run `pnpm exec mdsf verify` on both files; expect both unchanged.

**Step 3:** Run `pnpm -C astro exec astro sync`; expect successful content synchronization.

**Step 4:** Run `git diff --check` on the article, note, design, and plan; expect no whitespace
errors.

**Step 5:** Inspect the final diff for unsupported canon, fourth-wall language, and accidental
changes to unrelated files.
