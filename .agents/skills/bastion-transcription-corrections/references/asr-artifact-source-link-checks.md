# ASR artifact source-link checks

Use when a note cleanup or correction rule involves a name-like transcript artifact and Nico wants to inspect the source audio/transcript himself.

## Pattern

1. Search both `corrected_transcript.md` and `raw_transcript.md` for the suspect form and plausible canon neighbors.
   - Example forms from 2026-06-21: `Rubana`, `Rebun`, possible canon target `Raibon`.
2. Read a small window around the hit in both transcripts.
3. Report:
   - the local file path;
   - the exact timestamp span;
   - a GitHub line URL when the transcript is committed/published in-repo;
   - the raw-transcript comparison URL if the raw pass gives a useful alternate hearing.
4. Do **not** over-canonize the artifact from the text alone. If the phrase is not important to the summary, leave note prose focused on the scene mechanics and keep the artifact only in scoped correction guidance.
5. For correction rules, phrase the instruction as “treat X/Y in this transcript context as ASR drift around <known topic>, not as a new place/person” unless Nico confirms the heard canon term.

## Example

For the 2026-06-21 Summon Fey scene, `Rubana` appeared in the corrected transcript around `00:33:18–00:33:55`, while the raw transcript also had `Rebun`. The useful response was to give Nico the source links and timestamps, while keeping the shared rule scoped to Summon Fey/Essence of Nymph context rather than inventing a new Rubana entity.
