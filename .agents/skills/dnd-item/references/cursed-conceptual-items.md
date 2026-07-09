# Cursed conceptual / linguistic item pattern

Use this reference when creating BF items whose magic acts on concepts, vocabulary, memory, narration, or other soft/narrative affordances rather than simple damage/bonuses.

## Pattern

- Keep the `*.item.yaml` rules concise and table-usable: trigger, save/check if any, concrete mechanical consequence, recovery method, and botch/escalation clause.
- Put the richer metaphysics, unreliable explanations, collector lore, and jokes in the companion MDX article instead of stuffing the item data.
- For curses that remove language or knowledge, define exactly what is stolen: one precise technical/niche word, a name, a category label, a prepared phrase, etc. Avoid vague “you forget stuff” mechanics.
- Make the table effect playable without over-punishing the character: disadvantage or a failed exact-word requirement when precision matters is usually cleaner than broad silence/incapacity.
- Give the player a recovery ritual that is strange but actionable. If a botch is possible, have it steal a related term or worsen the conceptual tangle rather than dealing unrelated damage.
- If the item’s logic depends on absence, prior ownership, domestic folklore, or similar metaphysics, state the principle in the MDX and translate only the relevant consequence into YAML.

## Validation bundle that worked well

After writing the YAML + MDX pair, run focused checks instead of only relying on final build:

- `rumdl check <item-mdx-path>` for readable/valid MDX prose.
- A YAML parse check for the new `*.item.yaml` if no package-specific schema command is narrower.
- `git diff --check` to catch whitespace damage.
- `pnpm astro sync` from the repo root or `astro/` package context to validate content collections.
