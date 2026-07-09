# Session 2026-06-27 Speaker and Same-Name Entity Corrections

Use this as a compact example when Nico corrects a generated note's speaker attribution or same-name entity interpretation.

## Pattern

When Nico says a note got the direction of a line wrong or confused two similarly named entities:

1. Search the active note for the exact generated wording.
2. Check the same-date `corrected_transcript.md` around the relevant section when available.
3. If the transcript preserves the same mistake, patch both:
   - the authored note summary; and
   - the corrected transcript speaker tag or disambiguating name.
4. Prefer full names in ambiguous contexts, especially when two entities share a surface name.
5. Run `rumdl check` on the note and `git diff --check` on edited files.

## Concrete 2026-06-27 examples

- `Mark thanks Luana for caring for Emily` was corrected to Luana thanking Mark for taking care of Emily. The transcript line at `06:14:45` also needed `he says` -> `she says`.
- The `Like me` line in the Detect Life scene was Lime, not Emily, because Lime is also carrying twins and Justin is the father. The note should say Lime compares Emily's possible twins to Lime's own twins; the transcript speaker tag should identify Lime.
- The Slam Book / Arena fan conversation was about Henson Eastonton, not the stone golem. The note and transcript should use `Henson Eastonton` in that later social context, while preserving `Henson the Golem` for the actual golem body scenes.

## Lesson

Do not treat the generated note as the sole target. A note correction often exposes a matching speaker-attribution or entity-disambiguation bug in `corrected_transcript.md`; patch that source trail too so future summaries stop resurrecting the gremlin.
