# Provisional Place Audio Checks

Use this when a Bastion note contains an uncertain place/name and the user asks to verify the reference rather than promote a global correction.

## Evidence path

1. Search the authored note under `astro/src/content/docs/world/notes/...` for the term and nearby unresolved-hook wording.
2. Search `.bf-transcripts/session-YYYY-MM-DD/codex_notes/` for scene summaries and rolling context; these often preserve whether the notes model already marked the spelling as audio-checkable.
3. Search public transcript assets under `astro/src/assets/transcripts/session-YYYY-MM-DD/`:
   - `corrected_transcript.md`
   - `raw_transcript.md`
4. Compare raw and corrected transcript lines at the timestamp. Agreement supports the current transcript reading, but does not make it canon if no independent article confirms it.
5. Search canonical world docs (`astro/src/content/docs/world/**`) for independent confirmation before removing uncertainty.

## Output shape

- If only the transcript/codex/note support the term and support notes mark it unresolved, say it is the current transcript spelling and keep it provisional.
- Prefer note phrasing such as `a mountain heard as Mount X` or keep `Mount X` under `Unresolved Hooks`.
- Do not add a global `corrections.yaml` rule for a one-off place spelling unless the user confirms it or it recurs across sessions.

## Example: Mount Brissimis, 2026-06-14

- Authored note: `astro/src/content/docs/world/notes/the-vengeful/2026-06-14.mdx` mentions hot pools near Mount Brissimis and keeps `Mount Brissimis` under unresolved hooks.
- Codex scene notes: `astro/.bf-transcripts/session-2026-06-14/codex_notes/scenes/scene_001.md` says hot pools near Mount Brissimis, but explicitly says spellings and faction terms need verification.
- Corrected transcript: `astro/src/assets/transcripts/session-2026-06-14/corrected_transcript.md` lines around `00:53:34-00:53:59` say `Mount, uh, Brissimis` and `Brissimis, Mount Brissimis`.
- Raw transcript has the same reading at the same timestamp.
- No independent canonical article was found in world docs during the check.

Conclusion shape: `Mount Brissimis` is supported as the current transcript spelling, but remains provisional unless canon later confirms it.