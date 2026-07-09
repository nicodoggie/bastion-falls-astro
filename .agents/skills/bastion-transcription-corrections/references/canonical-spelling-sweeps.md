# Canonical Spelling Sweeps

Use this when Nico corrects a proper-name spelling that appears in generated notes and corrected transcripts, e.g. `Timahel` -> `Timael`.

## Pattern

1. Search the repo for the rejected spelling.
2. Patch authored notes and public corrected transcripts that preserve the same misspelling.
   - Do not edit `raw_transcript.md`; it is source evidence, not corrected output.
3. Check nearby context before using `replace_all` if the old spelling could be a different real entity.
4. For unambiguous spelling drift, add or update a narrow shared correction rule:
   - `status: confirmed`
   - `kind: entity` or the relevant class, e.g. `celestial`
   - rejected spelling in `aliases`
   - `safeExactReplacement: true` only if the spelling cannot plausibly refer to anything else.
5. Run `rumdl check` on edited MDX notes and `git diff --check` on all edited files. If the shared correction YAML changed, run the CLI tests that validate correction rule loading.

## Example

Nico clarified `Timahel should be Timael` while reviewing the 2026-06-27 Vengeful note.
The durable fix touched:

- `astro/src/content/docs/world/notes/the-vengeful/2026-06-27.mdx`
- `astro/src/content/docs/world/notes/the-vengeful/2026-06-14.mdx`
- `astro/src/assets/transcripts/session-2026-06-27/corrected_transcript.md`
- `astro/src/assets/transcripts/session-2026-06-14/corrected_transcript.md`
- `astro/.bf-transcripts/corrections.yaml`

The raw transcript still contained the old spelling and was left unchanged.
