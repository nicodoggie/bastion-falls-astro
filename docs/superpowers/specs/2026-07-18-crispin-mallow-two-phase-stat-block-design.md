# Crispin Mallow Two-Phase Stat Block Design

## Goal

Replace Crispin Mallow's generic Candlebearer statistics with a two-phase boss encounter that
reveals his fleshcraft, stolen identities, Dragonheart ancestry, and delusion that his human body
imprisons a true golden dragon.

## Canon Boundaries

- Crispin remains the Bearer of the Candle and a displaced member of House Dragonheart.
- He is not a dragon. His belief that he possesses a sealed draconic body is a delusion.
- His ability to take faces, exchange limbs, and create lifelike flesh golems comes from fleshcraft
  and transformation magic.
- His second form is a constructed imitation of a gold dragon assembled inside his humanoid body
  from stolen organs, limbs, and identities.
- Whether the Reformists consider Crispin a sincere alternate claimant to the Seneran throne or
  merely exploit his belief remains unresolved outside the stat blocks.

## Encounter Structure

### Phase One: Crispin Mallow, Bearer of the Candle

Keep Crispin near CR 11. He fights as a controlling spellcaster and flesh anatomist, using a
borrowed face, detached limbs, body-part exchange, and command over flesh golems. When reduced to 0
hit points, his prepared humanoid shell opens and the second form replaces him at full hit points.

### Phase Two: Crispin's Gilded Anatomy

Use a CR 17 Huge monstrosity rather than a dragon. The intact form imitates an adult gold dragon
with flight, fire, radiant breath, legendary resistance, and legendary actions. Its descriptions
reveal that every draconic feature is counterfeit fleshwork.

## Exploitable Weakness

Restorative magic of 2nd level or higher does not heal the Gilded Anatomy. Instead, it causes one
level of Graft Rejection. A nearby creature can also tear out the infernal piercing to cause one
level.

1. The false scales separate: AC falls and fire immunity becomes resistance.
1. The wings and auxiliary limbs revolt: speeds fall and legendary-action economy weakens.
1. The counterfeit heart is exposed: Legendary Resistance is lost, breath damage is halved, and the
   creature takes immediate radiant damage.

The intact statistics remain appropriate to CR 17. A party that spends actions and spell slots to
cause all three Rejections fights a creature whose defenses and damage output have degraded toward
CR 14.

## Data Layout

- Modify `astro/src/content/docs/world/misc/crispin-mallow-candlebearer.creature.yaml` for phase
  one.
- Create `astro/src/content/docs/world/misc/crispin-mallow-gilded-anatomy.creature.yaml` for phase
  two.
- Add the second collection id to `astro/src/content/docs/world/misc/maltreks-reformists.mdx` and
  render it immediately after Crispin.

## Verification

Validate both YAML entries through Astro content sync, run focused YAML lint, check the touched MDX
with rumdl, and inspect the final diff for unrelated changes.
