---
name: bastion-expand-world-article
description: Expand or create Bastion Falls world MDX articles from existing campaign notes, transcriptions, and related pages. Use when the user asks to fill out a character, location, item, organization, event, religion, family, or other world article based on existing notes; asks for stub/thin article expansion; asks to add lore from Vengeful, Sea Hags, Gerta, Feydark/Feywild, or other campaign notes; or asks to correct article canon using note evidence.
---

# Bastion World Article Expansion

Use this workflow for lore article work in `bastion-falls-astro`, especially under
`astro/src/content/docs/world/**`.

## Core Rules

- Write article prose in an in-world, Wikipedia-like omniscient voice: as if by a chronicler inside
  Bastion Falls, not an agent summarizing a table conversation.
- Do not include fourth-wall phrases such as "notes say", "campaign", "Vengeful-era notes",
  "later discussions", "mistranscription", "table conversation", "player", "DM", or
  "correction-phase" in the article body.
- When preserving a transcription-like or language-drift form that has become meaningful, frame it
  diegetically: e.g. "in Seneran records and local speech" or "as rendered in local usage", not as
  an out-of-world transcript artifact.
- Correct article text directly when attribution is wrong. Do not add visible correction
  bookkeeping to the article.
- Ask the user before editing source notes, transcriptions, Google Docs, or other support
  documents. It is fine to identify source-note fixes while expanding an article, but do not apply
  them unless the user explicitly approves that note/document cleanup.
- Preserve meaningful in-world uncertainty: use it only when the world itself would be uncertain.
- Keep article scope focused. Do not create a separate article for a supporting object, persona, or
  concept unless the user asks or the lore has enough independent weight.
- Link only the first article-body reference to a given non-note world article. Later mentions
  should be plain text.
- Link to non-note world articles, not to campaign notes, unless the article already uses footnotes
  for source tracking or the user explicitly asks for note citations.

## Workflow

Session brainstorm references that may become article source material:

- `references/vegetal-dairy-lactic-cosmology.md` — cabbage/Brassican brine-relics, Bovine Collective lactomancy/galactomancy dispute, salt cosmology, and related adventure hooks. Treat as brainstorm notes; ask before canonizing.

### Saving non-core brainstorm lore

When Nico says a strong riff is worth saving but may not be core Bastion Falls fare, prefer a
`astro/src/content/posts/<slug>.mdx` blog-post seed over a canonical `docs/world/**` article unless
he asks for canonization. Use tags like `worldbuilding-seed` and `non-core`, include an explicit
status note that it is compost/seed material, and if Nico asks Ran to be credited, set optional
frontmatter such as `author: Ran` while also keeping a visible body byline like `_By Ran._`. The
blog schema in `astro/src/content.config.ts` now supports optional `author`, but existing layouts may
not render it yet, so keep the body byline when attribution should be visible.

1. Inspect the target article first.
   - Read frontmatter and body.
   - Note existing schema patterns: `details.aliases`, `relationships`, `stats`, `Spell`,
     `StatBlock`, footnotes, and section style.
   - Check whether the page is a stub, thin article, or already substantial.
   - If resuming an interrupted session where prose was already drafted, recover the exact prior
     draft before editing; do not recompose it from memory. Compare the current file and working
     tree state first so existing user edits, such as corrected names in lists, are preserved.

1. Gather local evidence before writing.
   - Search campaign notes with `rg` for the canonical name, aliases, common misspellings, and
     related people/items/locations.
   - Search the target article's surrounding category and related articles for established facts.
   - For old CMS tags like `\[character:123]`, resolve from repeated context before patching. If the
     mapping is uncertain, report likely candidates instead of guessing.
   - When the user clarifies canon, treat that as settled in the active article. If the user is
     explicitly canonizing an unresolved note term, also remove or revise the matching unresolved
     hook and update the narrow support trail/correction rule so the same term is not re-questioned.
     For broader source cleanup beyond the clarified fact, summarize proposed edits and ask before
     applying them.
   - When the user adds article-worthy detail immediately after a note-cleanup clarification, keep
     the support trail synchronized: update the article prose/frontmatter, the active note summary if
     it already contains that fact cluster, and the matching correction rule if future transcription
     or note generation would benefit. Do not expand unrelated article sections unless asked.

1. Separate facts by confidence.
   - Use settled user clarifications and direct note evidence as canon.
   - Treat transcription artifacts and obvious name drift as source errors, not as article lore.
   - If a detail may belong to another character because of a similar name, do not preserve the
     error in prose; omit it until confirmed, or ask permission to correct the source reference.

1. Draft the article.
   - Prefer concise sections such as `Overview`, `Background`, `Family`, `Career`, `Affiliations`,
     `Notable Events`, `Abilities`, or domain-specific equivalents.
   - For newly canonized minor locations, create a compact but real stub article rather than leaving
     the name only in notes: title/frontmatter, `location.type`, `location.parents`, a one-paragraph
     definition, and one paragraph tying it to the settled surrounding geography. Also update the
     relevant parent/regional page and nearby stub article with first-use links.
   - Avoid game-stat prose in article bodies. Frontmatter may contain stats, but body text should
     not say "AC", "hit points", "speed", "level", or similar table-language unless the page is a
     stat block page.
   - Use `Spell` components for named D&D spells when the repo already supports them, e.g.
     `<Spell name="mage hand" src="phb" />`.
   - Prefer compact paragraphs over bullet lists unless the existing page is reference-like.

1. Edit carefully.
   - Use `apply_patch` for manual edits.
   - Preserve unrelated user changes in the worktree.
   - Do not revert files unless the user explicitly asks.
   - Do not edit source notes/documents during an article expansion unless the user has approved
     those source edits in the current task.

1. Validate narrowly.
   - Run `pnpm exec rumdl check <touched-mdx-files> --config .rumdl.toml`.
   - If rumdl reports mechanical wrapping/formatting issues, run
     `pnpm exec rumdl fmt <touched-mdx-files> --config .rumdl.toml`, then re-check.
   - Run `pnpm -C astro exec astro sync` when frontmatter/schema shape changed or a new content file
     was created.
   - Mention existing unrelated warnings separately from failures.

## Article Voice Checklist

Before finishing, scan the edited body for:

- Fourth-wall source labels: "notes", "campaign", "session", "transcription", "table
  conversation", "player", "DM".
- Correction labels: "mistranscription", "misattribution", "correction phase".
- Language/alias notes that should be kept but are currently framed externally; rewrite them as
  in-world record, local speech, scribal, or Seneran/local-language renderings.
- Stat language: "AC", "hit points", "walking speed", "level", "class features".
- Over-linking repeated names.
- Unsupported certainty where the evidence is still unclear.

When one appears, remove it or rewrite it into in-world language. If the underlying source note
needs correction, ask before editing that source.
