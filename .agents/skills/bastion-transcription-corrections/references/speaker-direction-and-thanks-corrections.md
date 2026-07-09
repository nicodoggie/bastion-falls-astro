# Speaker Direction and Thanks Corrections

Use this when a generated campaign note reverses who thanked whom, who cared for whom, or who asked/answered a short social exchange.

## Pattern

A short exchange can be summarized backwards when the transcript speaker tag is wrong or ambiguous. In the 2026-06-27 Vengeful note, the generated note said Mark thanked Luana for caring for Emily. Nico corrected that the scene was Luana thanking Mark for taking care of Emily.

Transcript evidence:

```md
[06:14:41 - 06:14:45] "Nice to meet you, Luana."
[06:14:45 - 06:14:49] "Thank you for taking care of my friend, Emily," she says.
[06:14:49 - 06:14:53] "Oh, um, you're welcome."
```

The corrected transcript previously had `he says`; the surrounding dialogue and `you're welcome` reply made the correction to `she says` appropriate.

## Workflow

1. Search the corrected transcript for the exact generated note wording and nearby names.
2. Read a small timestamp window around the exchange, not just the single line.
3. Use adjacency clues:
   - direct address (`Nice to meet you, Luana`) may identify the previous speaker;
   - `you're welcome` usually replies to the person who gave thanks;
   - a possessive like `my friend, Emily` should be checked against known relationships.
4. Patch both:
   - the authored note summary, and
   - the corrected transcript speaker tag if the transcript line itself encodes the wrong speaker.
5. Validate the note with `rumdl check` and run `git diff --check` on the edited note/transcript files.

## Pitfall

Do not promote this as a global character relationship rule unless the same reversal recurs. It is usually a local speaker-attribution cleanup, not a durable canon fact.