---
name: dnd-import-ddb-cha
description: Use when the user asks to import, refresh, update, or merge a DDB/D&D Beyond/ddb.ac character sheet into an existing or new Bastion Falls character article.
---

# DDB Character Import

Use this skill to import authenticated D&D Beyond character sheet data as raw
JSON, then merge useful sheet content into Bastion Falls character MDX with
human judgment.

## Workflow

1. Confirm the character URL or ID.
   - Accept `https://www.dndbeyond.com/characters/<id>`,
     `https://ddb.ac/characters/<id>`, or a numeric ID.
   - If the user names an existing character article, inspect that MDX first for
     an existing `character.ddb` link.
1. Fetch raw DDB JSON with `bfcli`.
   - From the repo root, run:

     ```bash
     yarn bfcli ddb import-cha --useExistingChrome --port 9224 --force --out /tmp/ddb-character-<id>.json <url-or-id>
     ```

   - If no authenticated Chrome DevTools session is running, run:
     `yarn bfcli ddb import-cha --force --out /tmp/ddb-character-<id>.json <url-or-id>`
     Then complete D&D Beyond login in the opened Chrome window and press Enter
     in the terminal.
   - Use `--chrome /usr/bin/google-chrome-stable` when the default Chrome path
     is wrong.
1. Inspect the JSON artifact.
   - Read `/tmp/ddb-character-<id>.json`.
   - Use `.character` as the raw DDB payload.
   - Preserve `.importedFrom` as evidence/source metadata if useful in notes.
   - Inspect DDB Notes fields, not only mechanical fields. If the character
     article has little or no existing biography/content, use public-facing
     character notes, backstory, description, personality, ideals, bonds, flaws,
     organizations, allies, enemies, and other player-entered notes as source
     material for the first draft.
   - Treat private/player notes as source material to summarize, not as text to
     quote wholesale, unless the user explicitly requests verbatim text.
1. Merge into MDX carefully.
   - Update safe mechanical fields: `character.ddb`, `character.stats`,
     `character.speed`, and concise prose summary of class/level, AC, max HP,
     speed, senses, and languages.
   - Do not blindly overwrite lore fields such as `details.species`,
     `details.sex`, `details.pronouns`, `mortality`, relationships,
     organizations, aliases, dates, or biography. DDB race/species may reflect
     mechanics rather than canon.
   - Prefer adding a cautious in-world sentence over replacing existing
     narrative, such as “Accounts of her abilities emphasize…” or “Some records
     associate her with…”.
   - For an empty or stub article, create an in-world biographical article:
     write in a neutral encyclopedia style, similar to a Wikipedia biography,
     and present facts as campaign-world knowledge rather than as player-sheet
     metadata.
   - Never mention out-of-world sourcing in article prose. Avoid phrases such
     as “campaign notes,” “D&D Beyond sheet,” “DDB notes,” “player notes,”
     “session notes,” “the sheet lists,” or “mechanically.” Keep those details
     in frontmatter, import artifacts, or the final response instead.
   - Recast source uncertainty diegetically. Use phrases such as “records
     describe,” “accounts portray,” “is said to,” “appears to have,” “some
     records use,” or “is associated with” instead of naming the real-world
     source.
   - Link the first mention of known existing characters, locations,
     organizations, peoples, events, and important items to their existing MDX
     articles using relative markdown links. Do not link repeated mentions.
   - Keep speculative or sheet-only details cautious. Prefer “is described as,”
     “is associated with,” or “some records note” when the DDB note is not yet
     corroborated by existing campaign lore.
1. Validate.
   - Run `yarn astro sync` from `astro/` after edits.
   - Report any existing unrelated dirty files separately.

## DDB Field Hints

- Character name: `character.name`.
- Classes: `character.classes[].definition.name` plus
  `character.classes[].level`.
- Ability scores: `character.stats[]` where IDs are STR 1, DEX 2, CON 3, INT 4,
  WIS 5, CHA 6. Prefer `overrideStats[]` when a numeric override exists.
- Species/race: `character.race.fullName`, but treat it as mechanics unless the
  user confirms canon.
- HP: prefer `overrideHitPoints` when numeric; otherwise combine
  `baseHitPoints + bonusHitPoints`.
- Notes/backstory/personality fields may appear in nested DDB payload locations;
  search the JSON for `notes`, `backstory`, `description`, `personality`,
  `ideals`, `bonds`, `flaws`, `organizations`, `allies`, and `enemies` before
  deciding there is no narrative source material.
- DDB URL in MDX should usually be canonicalized to
  `https://ddb.ac/characters/<id>`.
