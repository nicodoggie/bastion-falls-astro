# Ramboys Provisional Article Design

## Goal

Create a compact, provisional world article for _Ramboys_ using only currently established canon.
The article should give the publication an independent identity without inventing a mature roster,
founding date, regular columns, sponsors, or editorial practices that have not yet appeared.

## Canonical Scope

- _Ramboys_ is an adult magazine run by the same Ministry of Science publishing operation
  responsible for _Nightshift Nurses_ and _Legally Bare_.
- It is centered on male models.
- Its intended readership includes both the gay community and middle-aged housewives; it should not
  be framed as serving an exclusively gay male audience.
- Its paired performers are called **Bottoms**, paralleling the **Dick Models** used by its sister
  publications.
- Hellion Blanchimontt is the currently established model.
- Hellion will participate only if Trajan serves as his Bottom.
- Hellion intends to propose using coded material in _Ramboys_ to identify pickup ports for a
  black-market Herb of the Harem network. The proposal remains subject to publisher approval; it is
  not an accepted use of the publication or established Ministry policy.
- The publication and its conventions are deliberately established recurring canon. Their
  out-of-world player provenance must not appear in article prose.

## Article Shape

Create `astro/src/content/docs/world/organizations/ramboys.mdx` with organization frontmatter and
the tags `organizations`, `Magazine`, and `Ministry of Science`.

The body will use concise, in-world prose under three sections:

1. **Purpose and Format** — situate _Ramboys_ beside its sister publications, describe its
   male-model focus, and identify gay readers and middle-aged housewives as target audiences without
   inventing a founding date or educational specialty.
1. **Models and Bottoms** — define the Bottom role by comparison with Dick Models and record
   Hellion's condition that Trajan be his partner.
1. **Proposed Coded Trade** — distinguish ordinary magazine distribution from Hellion and Captain
   Illegal E. Bear's intended proposal to use coded content for illicit herb pickups, explicitly
   preserving that the publisher has not approved it.

## Supporting Edit

Link the first `Ramboys` reference in the July 19 Vengeful note to the new article without changing
the settled description of Hellion's proposal.

## Voice and Boundaries

- Use an in-world, Wikipedia-like voice.
- Do not mention players, Dungeon Masters, sessions, transcripts, or provisional drafting.
- Do not present the black-market proposal as already submitted, accepted, implemented, or
  officially sanctioned.
- Do not invent additional models, Bottoms, columns, issue numbers, dates, sponsors, or contractual
  terms.

## Verification

- Run `pnpm exec rumdl check -c .rumdl.toml` on the new article and July 19 note.
- Run `pnpm exec mdsf verify` on both files.
- Run `pnpm -C astro exec astro sync` because a new content page is being added.
- Run `git diff --check` on both files and inspect the final diff for unsupported additions or
  fourth-wall phrasing.
