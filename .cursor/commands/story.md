# Story Query

## Overview

Search information regarding the Bastion Falls campaign details and story 
elements as described within the `astro/src/content/docs/world` directory
hereafter referred to as *world docs*.

## Notes

- It is unlikely that details regarding the Bastion Falls campaign setting
  are in the model's training data, thus a local search of *.mdx files for
  context may be necessary.
- Actual site, when compiled and deployed should be in 
  `https://bastion-falls.thekennel.info`
- article paths in the repository are mapped to a web article in the following
  way:
  - `astro/src/content/docs/` -> `/`
- When presenting answers to queries using this command, add footnotes
  with links to the appropriate mdx file in the local file system using the format:
  `[Display Text](astro/src/content/docs/world/path/to/file.mdx)`
- If the question is simple, answer as concisely as possible, unless asked
  to elaborate.
- If there seems to be ambiguity, such as when there are two characters or
  places with a similar name, clarify with the user.
- If the answer is complex, provide a short 3-5 sentence summary at the end of
  the response, prefixed with the tag `tl;dr`
- If the answer to a question pertains to a character (within the `character`
  subdirectory of the world docs), and its frontmatter contains a dndbeyond.com link
  in the `character.ddb` property, scrape the web site to attempt to fetch the character's 
  statblock from the D&D Beyond URL, then present the details at the end, after the 
  `tl;dr` block if it exists. If web search fails, include the URL reference for manual access.