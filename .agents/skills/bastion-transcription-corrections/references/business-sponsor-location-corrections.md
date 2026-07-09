# Business / Sponsor Location Corrections

Use this when Nico clarifies a named business, sponsor, advertiser, owner, location, or customer base during note cleanup.

## Pattern

1. Patch the active session note to replace vague business wording with the clarified facts.
   - Prefer concrete location wording (`in Port Tressemer`) over generated hedges (`around Tressemer school or academy areas`).
   - If Nico names a customer base or institution, write it directly (`popular with teenage and young-adult students at Tressemer Academy`).
   - If Nico says the business advertises in or sponsors a publication, capture that relation explicitly.
2. Check directly implicated canonical articles for stale sponsor-list wording or typos.
   - Example: a sponsor list entry can contain the same business and owner relation; fix `owned my`/dangling-owner phrasing there too.
3. Add a narrow `kind: business` or `kind: organization` rule in `corrections.yaml` when future transcription passes may mishear the business name or relationship.
   - Include aliases such as accentless spelling or likely ASR drift (`Warp Star Cafe`, `Warp Star Coffee`).
   - Put owner, location, advertiser/sponsor relation, and customer-base facts in the instruction when Nico settled them.
   - Keep `safeExactReplacement: false` if the alias could be a generic phrase or another business.
4. Validate the edited note/article with `rumdl`, run `git diff --check`, and parse `corrections.yaml`.

## Example from 2026-06-27 cleanup

Nico clarified that Warp Star Café:

- is in Port Tressemer;
- is popular with teenage and young-adult students at Tressemer Academy;
- advertises in Legally Bare;
- is owned by Ashmodai.

The active note changed the vague `popular around Tressemer school or academy areas` line into those specific facts, the Legally Bare sponsor list typo was fixed, and a `business.warp-star-cafe` correction rule was added.