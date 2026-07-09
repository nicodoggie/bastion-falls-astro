# Creating an item from an active note correction

Use this when Nico invokes `/dnd-item` while actively correcting a campaign note or when the proposed item is already mentioned in the current note.

## Pattern

1. Create the `*.item.yaml` and companion `.mdx` as usual.
2. Patch the active note if the item spec corrects note facts such as name, rarity, attunement, activation, or mechanism.
   - Example: `rare magical page finder` became **uncommon magical Page Finder**.
   - Keep the note concise; it should summarize the item in scene context, not duplicate the full item rules.
3. Add or update a narrow `corrections.yaml` rule when the drift is likely to recur in transcription cleanup.
   - Include the item article and item-data file as canonical refs when they now exist.
   - Preserve context limits, e.g. binder/page-search contexts rather than global phrase rewrites.
4. Validate the item and all touched support trail files:
   - `rumdl check` for touched MDX note/article files.
   - YAML parse or schema validation for the item YAML and corrections YAML.
   - `pnpm astro sync` from `astro/` for new item content.

## Pitfalls

- Do not leave an active note saying `rare` or vague wording if the newly created item canon says `uncommon` or has a settled name/mechanic.
- Do not paste full rules text into the campaign note; link/canonicalize the item page and keep the note scene-focused.
- Re-read the generated MDX or rely on `rumdl`/`astro sync` to catch tiny component syntax slips such as `< ItemBlock ... />` before finishing.
