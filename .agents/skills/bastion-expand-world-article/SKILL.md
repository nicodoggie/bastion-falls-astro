---
name: bastion-expand-world-article
description: Expand or create Bastion Falls world MDX articles from existing campaign notes, transcriptions, and related pages. Use when the user asks to fill out a character, location, item, organization, event, religion, family, or other world article based on existing notes; asks for stub/thin article expansion; asks to add lore from Vengeful, Sea Hags, Gerta, Feydark/Feywild, or other campaign notes; or asks to correct article canon using note evidence.
---

# Bastion World Article Expansion

Use this workflow for lore article work in `bastion-falls-astro`, especially under
`astro/src/content/docs/world/**`.

## Core Rules

- Write article prose in an in-world, Wikipedia-like omniscient voice.
- Do not include fourth-wall phrases such as "notes say", "campaign", "Vengeful-era notes",
  "later discussions", "mistranscription", or "correction-phase" in the article body.
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

1. Inspect the target article first.
   - Read frontmatter and body.
   - Note existing schema patterns: `details.aliases`, `relationships`, `stats`, `Spell`,
     `StatBlock`, footnotes, and section style.
   - Check whether the page is a stub, thin article, or already substantial.

1. Gather local evidence before writing.
   - Search campaign notes with `rg` for the canonical name, aliases, common misspellings, and
     related people/items/locations.
   - Search the target article's surrounding category and related articles for established facts.
   - For old CMS tags like `\[character:123]`, resolve from repeated context before patching. If the
     mapping is uncertain, report likely candidates instead of guessing.
   - When the user clarifies canon, treat that as settled in the active article. If directly
     relevant notes/documents also need cleanup, summarize the proposed source edits and ask before
     applying them.

1. Separate facts by confidence.
   - Use settled user clarifications and direct note evidence as canon.
   - Treat transcription artifacts and obvious name drift as source errors, not as article lore.
   - If a detail may belong to another character because of a similar name, do not preserve the
     error in prose; omit it until confirmed, or ask permission to correct the source reference.

1. Draft the article.
   - Prefer concise sections such as `Overview`, `Background`, `Family`, `Career`, `Affiliations`,
     `Notable Events`, `Abilities`, or domain-specific equivalents.
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

- Fourth-wall source labels: "notes", "campaign", "session", "transcription", "player", "DM".
- Correction labels: "mistranscription", "misattribution", "correction phase".
- Stat language: "AC", "hit points", "walking speed", "level", "class features".
- Over-linking repeated names.
- Unsupported certainty where the evidence is still unclear.

When one appears, remove it or rewrite it into in-world language. If the underlying source note
needs correction, ask before editing that source.
