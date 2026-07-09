# User-settled place canon pattern: Mt Brissimis

Use this as a compact model when a transcript/heard place name was previously unresolved and Nico later settles the canon.

## Trigger

- A note has an unresolved hook like `Confirm places and terms: Mount Brissimis`.
- Transcript/codex support shows the spelling was heard but not independently canonized.
- Nico explicitly resolves it, e.g. "Mt Brissimis is where the pools are, in the northern portion of the Western Maltreks."

## Actions

1. Promote the correction rule from unresolved/provisional to confirmed:
   - `kind: place`
   - canonical title from Nico's wording (`Mt Brissimis`)
   - aliases for transcript variants (`Mount Brissimis`, `Brissimis`)
   - narrow contexts (`Thralmals pools`, `northern Western Maltreks geothermal sites`)
   - evidence note that Nico settled the canon.
2. Remove the item from unresolved hooks in the session note.
3. Update the active note's prose from "heard as" / uncertain wording to settled canon.
4. If support/codex notes explicitly list the spelling as needing verification, update that audit trail too so future sweeps do not rediscover a solved question.
5. Validate `corrections.yaml` by parsing YAML and checking duplicate IDs.
6. If MDX notes/pages changed, run a narrow `rumdl check` and any relevant Astro/content check.

## Important distinction

Do not infer hard canon merely because the transcript and generated notes agree. The promotion happens because Nico settles it, or because a canonical article already exists. Before that, keep the term provisional and visible in unresolved hooks.
