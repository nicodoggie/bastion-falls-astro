# Crispin Mallow Character Article Design

## Goal

Create a canonical character article for Crispin Mallow and make it the sole rendered home of his
Candlebearer and Gilded Anatomy stat blocks.

## Canon Treatment

The article states that Crispin is a displaced member of House Dragonheart, a Reformist
Candlebearer, a master fleshcrafter, and a human suffering from the delusion that his body imprisons
a true golden dragon. His precise dynastic standing remains unknown. The article does not decide
whether Reformist leaders sincerely cultivate him as an alternate claimant or exploit a politically
useful delusion.

Crispin can create lifelike flesh golems, steal faces, exchange limbs, and build the counterfeit
Gilded Anatomy. His responsibility for the specific Malthrek replacement bodies, altered court
wizards, submarines, and other current operations remains unresolved.

An ancient gold dragon preserved itself during the disappearance of magic by compressing its body
and identity into the Gold Canary Figurine of Wondrous Power. Crispin later killed the manifested
dragon and harvested it to construct the Gilded Anatomy. Returning those parts may make restoration
possible, but whether the dragon's identity survived and what restoration requires remain open for
play.

## Structure

1. Overview and public covers
1. Dragonheart displacement and succession ambiguity
1. Candlebearer office
1. Draconic delusion and fleshcraft
1. Castle Malthrek activity
1. Unresolved operations
1. Encounter statistics

## Integration

Create `astro/src/content/docs/world/characters/crispin-mallow.mdx` with character frontmatter,
relationships to House Dragonheart and the Reformed Church of Divine Masochism, and both creature
collection references. Remove both rendered Crispin blocks from the general Malthrek Reformists page
and replace them with a link to the character article.

## Verification

Run rumdl against both touched MDX files, Astro content sync for the new frontmatter, a full Astro
build, rendered-output inspection, and scoped diff checks.
