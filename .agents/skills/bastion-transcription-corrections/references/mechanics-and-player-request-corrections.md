# Mechanics and Player-Request Corrections

Use this reference when Nico clarifies a generated note's uncertain table mechanics or distinguishes a one-off player-requested arc beat from reusable campaign mechanics.

## Pattern

1. Patch the active note's uncertain wording directly.
   - Replace vague lines like "mechanics unclear" or "needs audio review" when Nico has now settled the table logic.
   - Preserve looseness if Nico says the mechanics are not final.
2. Separate table convention from special-case adjudication.
   - Example: pregnancy generally used two consecutive d20 rolls below 10.
   - Emily's possible twins were a player-requested arc beat after the clone/double situation, not a general pregnancy rule.
   - The twins request was adjudicated similarly with another two d20 rolls below 10 to see whether the DM would allow it.
3. Promote reusable guidance to `corrections.yaml` as a `kind: mechanics-note` rule when future transcription/note passes are likely to overcanonize the same mechanics.
4. In the rule instruction, state both what is firm and what is intentionally loose/refineable.
5. Validate the edited note and YAML:
   - `pnpm exec rumdl check <note>`
   - `git diff --check -- <note> astro/.bf-transcripts/corrections.yaml`
   - parse `corrections.yaml` with Python/YAML.

## Rule shape example

```yaml
- id: mechanics.pregnancy-rolls
  status: confirmed
  kind: mechanics-note
  canonical: Pregnancy rolls
  canonicalRefs: []
  aliases:
    - pregnancy mechanics
    - twin rolls
  scope:
    campaigns:
      - the-vengeful
    contexts:
      - pregnancy checks
      - Emily's possible twins
      - clone or double aftermath
  apply:
    mode: prompt-first
    safeExactReplacement: false
  instruction: >
    Pregnancy mechanics are intentionally loose. The only firm table convention is that pregnancy
    typically requires two consecutive d20 rolls below 10. Emily's possible twins are not a general
    pregnancy rule; they are a player-requested arc beat after the clone/double situation and were
    adjudicated similarly. Preserve that the DM may refine these mechanics later.
```

## Pitfall

Do not turn a player-requested character arc allowance into a universal mechanics rule. If Nico says he may refine it later, preserve that as an explicit uncertainty rather than pretending the current ruling is a finalized subsystem.
