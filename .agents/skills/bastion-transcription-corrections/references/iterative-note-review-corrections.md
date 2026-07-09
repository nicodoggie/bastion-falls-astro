# Iterative Note-Review Corrections

Use this when Nico is walking through a generated campaign note line-by-line and giving short canon corrections such as `X should be Y`, `this speaker was probably A`, or `this unresolved hook is actually B`.

## Pattern

1. Treat each user correction as both a note fix and a possible source-trail fix.
2. Search the active note for the exact bad wording and patch the note first.
3. Search same-date and directly implicated earlier `corrected_transcript.md` files for the same bad spelling, attribution, or place/name drift.
   - Patch public corrected transcripts when they carry the same corrected-text mistake.
   - Leave `raw_transcript.md` alone as source evidence unless the task explicitly says otherwise.
4. Add or update a narrow `astro/.bf-transcripts/corrections.yaml` rule when the correction is likely to recur in future transcript or note passes.
5. Use the rule `kind` that matches the problem, not just the surface word:
   - exact proper-name spelling drift: `kind: entity`, often `safeExactReplacement: true` if unambiguous;
   - same surface name for different real things: `kind: disambiguation`;
   - relationship/title clarification: `kind: relationship`;
   - settled ruins/place context: `kind: place-context`;
   - loose table convention or player request: `kind: mechanics-note`.
6. If the user settles an unresolved hook, remove only that hook or uncertainty bullet; preserve unrelated open questions.
7. Validate the edited note with `rumdl check`; run `git diff --check` over all edited files; run CLI tests when `corrections.yaml` changed substantially.

## Examples from the 2026-06-27 review pass

- `Henson Eastonton` vs `Henson the Golem`: same-name collision, not a spelling replacement. Patch the active note and follow-up notes carrying the merge; update the shared rule to disambiguate Boyle's nephew from Miya's hijacked golem trap.
- `Timahel` -> `Timael`: user-settled proper-name spelling. Patch active/prior notes, public corrected transcripts, and add a narrow spelling rule. Raw transcript stays untouched.
- `Tiphanie, a mistress...`: title clarification. John calls Tiphanie `the mistress` because she requested that apprentice title; do not infer a romantic/sexual relationship or separate unknown mistress.
- `Storm Bjorn` -> `Stormbjorn`: settled place context. Rebecca supposedly comes from Stormbjorn, a centuries-old ruins in Northern Senera; do not leave the term unresolved or treat it as a functioning castle.
- Speaker attribution hints like `I think this is Kelthyr talking to Luana`: check the transcript window for surrounding speakers, then patch cautious attribution wording in the note.

## Common Pitfall

Do not only patch the visible generated note. Nico's correction often reveals the same mistake in `corrected_transcript.md` or in `corrections.yaml`; if that source trail stays stale, future summaries resurrect the same gremlin.
