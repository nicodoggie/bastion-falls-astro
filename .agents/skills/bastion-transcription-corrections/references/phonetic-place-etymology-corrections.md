# Phonetic Place Etymology Corrections

Use when Nico settles an unresolved heard place name by revealing that the transcript spelling is a phonetic/table rendering of a canon name or joke etymology.

## Pattern

1. Treat the user's settled form as canon, even if the prior spelling appears repeatedly in notes or transcript support files.
2. Update the location/article page:
   - canonical title/name in prose;
   - transcript/table spelling as an alias only;
   - the in-world etymology or table joke if Nico provided one.
3. Update directly implicated cross-reference pages so they do not preserve the unresolved spelling as a separate place.
4. Update the active session note/support trail:
   - replace uncertainty with the settled correction;
   - remove the resolved item from unresolved hooks;
   - keep unrelated hooks untouched.
5. Add or update a narrow `place.*` rule in `astro/.bf-transcripts/corrections.yaml`:
   - `status: confirmed` when Nico explicitly settled it;
   - aliases for transcript/table spellings;
   - `safeExactReplacement: false` unless the alias is an impossible real term;
   - instruction should say that the alias is a phonetic/table rendering, not a second location.
6. Validate edited MDX with `rumdl check`, run `git diff --check`, parse the YAML, and run `pnpm astro sync` when content collections may be touched.

## Example shape

A session note heard `Le Faerfalik`; Nico settled it as `Le Phare Phallique`, a Raibon Island lighthouse/settlement named because early settlers thought the lighthouse looked phallic. The durable outcome is:

- location article titled/canonized as `Le Phare Phallique`;
- alias `Le Faerfalik` retained only as phonetic/table rendering;
- Raibon Island page linked to the settled article;
- active note changed from unresolved spelling uncertainty to settled correction;
- shared correction rule `place.le-phare-phallique` added for future ASR/note cleanup.
