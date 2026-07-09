# Magic Item Open-Hook Resolution Pattern

Use when Nico identifies an unresolved item hook from a session note, especially when the item is a 5etools item with a garbled transcript name or an incomplete Identify result.

## Pattern

1. Treat Nico's item identification as canon for the active note.
   - Replace vague hooks like "star-shaped saving-throw card" with the exact item component, e.g. `<Item name="Star Card" src="BMT" />`.
   - Replace descriptive names like "golden canary figurine" with the exact source item, e.g. `<Item name="Gold Canary Figurine of Wondrous Power" src="FTD" />`.
2. Verify the item in `5etools-src/data/items.json` when available, but do not overrule Nico's campaign-specific clarification.
3. Preserve campaign-specific damage/obscured-function facts near the item description.
   - Example: the Gold Canary Figurine of Wondrous Power is broken in-session; damage obscures its adult gold dragon form, so the giant canary mount form alone is incomplete identification.
4. Remove only the resolved identification hook.
   - If a repair method remains unknown, keep a narrowed hook such as "Determine whether the broken item can be repaired enough to restore/reveal the hidden form."
5. Add or update a shared `corrections.yaml` rule when the item has likely recurring aliases, ASR drift, or misspellings.
   - Include common malformed spellings in aliases when Nico uses or mentions them: e.g. `Gold Canary Figurie of Woundrous Power`.
   - The rule instruction should distinguish official item identity from session-specific state.

## 2026-06-21 Examples

- `Star Card|BMT`: the star-shaped card that grants advantage on all saving throws for 10 minutes after a bonus-action command word.
- `Gold Canary Figurine of Wondrous Power|FTD`: the hidden golden canary figurine. Officially has giant canary and adult gold dragon forms; in-session, it is broken and hides/obscures the adult gold dragon property.
