# Sebastian Argras Character Article Design

## Goal

Canonize Sebastian Argras as the seneschal of House Rannek and distinguish that office from Angel
Rannek's personal habit of calling him “Butler.”

## Canon

- Sebastian Argras is the seneschal of House Rannek.
- “Butler” is not Sebastian's formal office or general title.
- Angel alone calls him “Butler,” using an imprecise domestic shorthand based on the work she sees
  him perform.
- Angel's usage may also carry familiarity or affection, but no single emotional intention is
  definitive.
- Sebastian's work may place him alongside the Rannek court wizards during household emergencies,
  but he is not established as a wizard.
- Reports concerning Sebastian during the Castle Rannek infiltration were compromised. His exact
  actions and condition remain unresolved.

## Article

Create `astro/src/content/docs/world/characters/sebastian-argras.mdx` as a compact canonical article
using the existing character frontmatter conventions.

The article will contain:

1. **Overview** — identify Sebastian and his official household position.
1. **Household Office** — describe his standing as seneschal without inventing a detailed portfolio
   of duties.
1. **Castle Rannek Crisis** — record his association with Marchioness Maria Rannek, the uncertain
   reports concerning him, and the distinction between working with court wizards and being one.

The prose will use an in-world chronicler's voice and will avoid campaign, transcript, game-stat, or
correction-bookkeeping language.

## Linked Canon Updates

- Update the Rannek household roster to place Sebastian under household officers as seneschal rather
  than under butlers.
- Link his first relevant mention in the August 2 authored note.
- Replace the August 2 boundary describing him as a butler with the settled distinction between his
  office and Angel's form of address.
- Add a concise reference from Angel Rannek's article if it fits the existing relationship prose
  without expanding unrelated sections.
- Add a scoped correction rule preventing future generated notes from treating “Butler” as
  Sebastian's official office or treating his proximity to court wizards as proof that he is one.

## Evidence Boundaries

The article will not invent Sebastian's age, ancestry, magical aptitude, personality, detailed
administrative powers, or fate during the infiltration. Ordinary responsibilities associated with
historical seneschals will not be attributed to him unless campaign evidence supports them.

## Verification

- Validate all touched MDX with `rumdl` and `mdsf`.
- Run Astro content synchronization because a new content article is being added.
- Validate correction-rule YAML and duplicate IDs.
- Run the CLI test suite if the correction store changes.
- Search for stale authored claims that Sebastian is formally a butler or a wizard.
- Confirm raw ASR remains untouched.
- Run `git diff --check`.
