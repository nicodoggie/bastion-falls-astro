# Merchandise Lore vs Side-Joke Debris

Use this pattern when a campaign-table discussion contains one confirmed commercial / item-lore idea surrounded by horny jokes, spooky hypotheticals, or practical cleanup banter.

## Trigger

Nico says a generated note partly got the scene right, e.g. "selling to VIPs is a thing," while nearby transcript material is "def can be ignored." This usually means the note should preserve the product/business possibility but demote the adjacent improv chatter.

## Pattern

1. Identify the real reusable anchor:
   - organization, product line, sponsor, VIP/customer channel, item class, or merchandise plan.
2. Patch the active note to name that anchor directly.
3. Convert side talk into an explicit negative boundary instead of deleting all trace:
   - "ignore unless later scenes return to it as explicit lore"
   - "do not treat cleanup jokes as item properties"
4. Update `corrections.yaml` on the umbrella entity rule when the anchor is an organization/product context, rather than minting a narrow one-off item rule for every joke.
5. Put the confirmed bit and rejected side talk in the same instruction so future cleanup passes preserve the useful lore without re-promoting the debris.

## Example Shape

```yaml
- id: organization.example-magazine
  status: confirmed
  kind: organization
  canonical: Example Magazine
  aliases:
    - Example Mag
  scope:
    campaigns:
      - the-vengeful
    contexts:
      - VIP merchandise discussion
  apply:
    mode: prompt-first
    safeExactReplacement: false
  instruction: >
    Treat the discussion of selling/giving model dolls or bag charms to VIPs as
    real merchandise lore. Preserve potential possession and salt-stuffing only
    as uncertain old-wives'-tale hooks when Nico identifies them that way. Treat
    Prestidigitation as a real mundane cleaning option, but do not track a
    specific cleanup joke/aside as item lore or meaningful spell-use canon unless
    a later scene revives it. Ignore nearby doll-eye and similar side talk unless
    later canon says otherwise.
```

## Pitfalls

- Do not swing from "side jokes are fake" to "the whole merchandise thread is fake." Preserve the confirmed commercial/logistics idea.
- Do not turn every joke phrase into an item property. A cleanup joke after a doll/figurine discussion is table banter unless explicitly tied to a magic item mechanic.
- Avoid over-specific new rule IDs when the durable correction is really about an organization or product-line context.

## Session Pattern

In The Vengeful 2026-06-27 cleanup, Legally Bare doll/bag-charm sales to VIPs were confirmed as a real possibility. Potential possession and salt-stuffing were later corrected into uncertain old-wives'-tale hooks, not proven mechanics; Prestidigitation remains a real cleaning option, but the specific cleanup aside in this scene should not be tracked as item lore or meaningful spell-use canon. Doll-eye and stuffie-servant talk remained ignorable unless later scenes revive them.