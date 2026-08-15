# Session Review Corrections Ledger Implementation Plan

> **For Hermes:** Execute this bounded data-and-skill plan directly; no subagent or bespoke tests
> are warranted.

**Goal:** Create the private 2026-08-08 human-review correction ledger, record the accepted Stacy
correction, and teach the note-cleanup skill to maintain future ledgers.

**Architecture:** Keep the ledger as an ignored session-local YAML artifact beside its transcript
evidence. Preserve generated transcripts unchanged. Update the procedural skill so accepted human
corrections are always logged, while only reusable drift is promoted to shared `corrections.yaml`.

**Tech Stack:** YAML, Markdown skill documentation, `js-yaml`, `rumdl`, Git whitespace checks.

---

## Task 1: Create the session review ledger

**Objective:** Record the accepted “space” → “Stacy” correction with portable provenance.

**Files:**

- Create: `astro/.bf-transcripts/session-2026-08-08/review-corrections.yaml`

**Steps:**

1. Create the approved versioned YAML shape with the 2026-08-08 session metadata.
1. Add one accepted correction covering 00:21:31–00:21:55.
1. Point evidence to the reconciled, left, and right session-002 transcript artifacts.
1. Point the note effect to the authored 2026-08-08 note’s `Searching the Guest Quarters` section.
1. Parse the file using the repository’s installed `js-yaml` package.
1. Assert the expected fields and verify every referenced evidence path exists.

### Task 2: Update the note-cleanup workflow

**Objective:** Ensure future accepted session corrections update the ledger without conflating
one-off recovery with reusable shared rules.

**Files:**

- Modify: `bastion-note-cleanup-workflows` skill `SKILL.md`

**Steps:**

1. Add ledger creation/appending after an accepted human correction.
1. State that both one-off and reusable accepted corrections enter the ledger.
1. Keep tentative suggestions and unresolved audio checks out.
1. Preserve the existing recurrence gate for shared `corrections.yaml` promotion.
1. Reload the skill and verify the workflow ordering.

### Task 3: Validate the bounded change

**Objective:** Prove the data artifact, skill workflow, authored note, and planning documents remain
well-formed.

**Steps:**

1. Parse and inspect `review-corrections.yaml` with `js-yaml`.
1. Run `rumdl check` on the authored note, design, and plan.
1. Run `mdsf verify` on the authored note.
1. Run `git diff --check` on tracked files changed during this correction pass.
1. Report that the ledger is gitignored/private and that no archive behavior or shared correction
   rule was added.

No commit is included without separate authorization.
