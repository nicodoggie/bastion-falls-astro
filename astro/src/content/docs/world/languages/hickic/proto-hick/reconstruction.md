---
title: Hickic Reconstruction Notes
description: Working notes for Proto-Hick and early Hickic branch reconstruction
tags:
  - proto-hick
  - reconstruction
---

These are working notes for Hickic reconstruction. They are not a polished reference grammar. Use
them to collect evidence, test sound-change assumptions, and separate inherited Proto-Hick material
from later branch innovations.

## Working Tree

The current working model treats the documented stages as historical layers rather than a single
direct jump from Proto-Hick to Early Hick.

```text
Proto-Hick
├─ Proto-Apgarian Hickic
│  ├─ Estregan
│  ├─ Anasaian
│  └─ Sanerian / Standard Apgarian
└─ Island / Seafaring Hickic
   └─ Proto-Maritime Hickic
      ├─ Maritime island branches
      ├─ later maritime pidgin and sailor lingua franca
      └─ Proto-Seneran Hickic
         └─ Pre-Early Hick
            └─ Early Hick
```

Each protolanguage represents both a shared ancestor and a period of shared innovation after some
degree of geographic or social isolation. Proto-Apgarian may preserve older mainland features, but
it is still a daughter branch with its own innovations. Proto-Maritime reflects the spread of
reliable seafaring and island settlement. Proto-Seneran reflects later settlement in Senera and
subsequent local development.

## Method

For each reconstruction problem, collect evidence from:

1. canonical Early Hick forms used in the Seneran reference material
1. Lexurgy outputs from `early-hick.lsc`
1. known later Seneran or Modern Seneran survivals
1. Apgarian and Maritime cognates where available
1. semantic and morphological plausibility

Then classify each result as:

- **keep**: fits the sound changes, morphology, and attested descendants
- **revise**: useful older intuition, but likely needs better rules
- **investigate**: promising, but not yet supported by enough evidence
- **branch-specific**: valid in one branch but not necessarily Proto-Hick

## Stage Checkpoints

The current `early-hick.lsc` file includes stage markers:

```text
Stage 0: Proto-Hick
Stage 1: Proto-Maritime Hick
Stage 2: Proto-Seneran Hick
Stage 3: Pre-Hick
Stage 4: Early Hick
```

These should be treated as testable checkpoints. The stage labels may need renaming or splitting as
the wider Hickic family model becomes clearer.

## Calibration Form: lawesu

The root family around `*lawesu` is a useful test case because it touches lexical inheritance,
grammaticalization, and fossilized case morphology.

### Current Lexurgy Outputs

Using the current `early-hick.lsc` rules:

```text
lawesu        > lawes
laʔesu        > la'es
lahesu        > las

ʔelu lawesu   > ewes
duwesu        > duwes
duhawesu      > duwes

ʔimeru lawesu > imewes
ʔimeru laʔesu > ime'es
ʔimeru lahesu > imes

bramu lawesu  > brawes
bramu laʔesu  > bra'es
bramu lahesu  > bras
```

### Working Interpretation

Plain `*lawesu` currently behaves best as a lexical root: "consume, take in, use, eat." This
supports descendants such as `ewes` and `duwes`.

The form `*lahesu` currently produces `las`. This makes it a strong candidate for a later
grammaticalized allomorph that became the productive Early Hick illative suffix `-las`.

The form `*laʔesu` produces apostrophe-bearing `-'es` shapes. This may belong with archaic or
fossilized inward/receptive forms, but it should not be treated as productive Early Hick morphology.

### Provisional Analysis

```text
Proto-Hick:
*lawesu = consume, take in

Proto-Maritime or Proto-Seneran:
*lahesu = reduced or grammaticalized inward allomorph

Early Hick:
*lahesu > -las
```

Possible fossil layer:

```text
Proto-Maritime or exploratory coastal usage:
*-laes / *-aes = inward, into, where something enters
```

The `-aes` layer is best treated as Proto-Maritime or early exploratory fossil material rather than
productive Early Hick morphology. This especially suits hydronyms and coastal descriptions, where
Maritime Hick speakers may have named features during first exploration. For example, `bram-aes` can
be understood as an older description of a tidal river or estuary, later inherited as
`Bramaes > Brams`.

This means the older statement `*lawes > *laes > -las` is too simple. The productive Early Hick
`-las` descends from a branch-specific grammaticalized allomorph, while `-aes` survives as a
fossilized or borrowed Maritime layer.

## Calibration Form: imris

The ellative and source-causative marker `-imris` is another high-value calibration form because it
is productive in Early Hick, but its older etymology is less secure than its synchronic function.

### Current Lexurgy Outputs

Using the current `early-hick.lsc` rules:

```text
ʔimeru ʔirisu  > imer'iris
ʔimeru ʔisu    > imer'is
ʔimerisu       > imeris
ʔimeru risu    > imeris

hisu           > is
hirisu         > iris
himrisu        > iris
himirisu       > imiris
himeru hisu    > imes
himeru hirisu  > imeris
himeru himrisu > imeris

ʔisu           > is
ʔirisu         > iris
risu           > ris
```

### Working Interpretation

The transparent derivation `ʔimeru ʔirisu > imris` is not produced by the current rules. The closest
regular output is `imeris`, from either `ʔimerisu` or `ʔimeru risu`.

The current working model is:

```text
Proto-Hick or early branch material:
*ʔimer-isu / *ʔimerisu = breath/soul at-or-outward, released breath

Regular development:
*ʔimerisu > imeris

Pre-Hick to Early Hick productive morphology:
imeris > imris
```

The final `imeris > imris` reduction should be treated as a special reduction in high-frequency
bound morphology, not as a general sound law. The productive Early Hick marker then extends from
physical/source ellative use into derivational and clause-linking functions:

```text
out of, from
> arising from
> caused by, because of
> cause to emerge or bring out
```

The `*risu` root is attested as "reed", so it should not be repurposed as the source of `-imris`.
The `*-isu` suffix is documented as locative "at, in"; its exterior/outward use should remain a
branch-specific or contextual development unless stronger comparative evidence is found.

The Early Hick word `kiris` should not currently be used as firm evidence that `*isu` originally
meant "out". Its etymology may need reanalysis or may represent folk etymology.

### Candidate Reanalysis: kiris

The current Early Hick lexicon derives `kiris` from `*kiru-ʔisu` "body-out", but the current Lexurgy
rules produce `kir'is`, not `kiris`. The cleaner sound-change path is:

```text
*kiru-risu > kiris
```

Since `*risu` is independently attested as "reed", this gives a literal sense "reed body". That
phrase can remain available as a botanical description of the body or stalk of a reed, while also
developing a socially marked sense through contact with plantlike fey:

```text
reed body
> reed-bodied being
> plantlike fey, especially wetland or reedbed spirits
> fey outsider, strange non-human person
```

This development fits a Maritime or Seneran setting better than an inherited Proto-Hick exterior
case etymology. Raibon Island and Senera both have strong later traditions of fey contact, wetland
crossings, and bog-associated magical beings, so `kiris` may reflect a branch-specific folk or
contact term rather than a general Proto-Hick derivation from `*-isu`.

## Calibration Form: itaru

The superessive marker `-itar` and the inland/fossil form `-iter` need to be kept separate in
synchronic Early Hick description, even if they may be historically related.

### Current Lexurgy Outputs

Using the current `early-hick.lsc` rules:

```text
ʔitaru > iter
hitaru > iter
```

The regular sound-change path is:

```text
*ʔitaru
> *ʔi.ta.ru
> *'ʔi.tə.rə
> *'i.tə.rə
> *'i.trə
> iter
```

Bare `itaru` is not a valid Proto-Hick input under the current syllable model, because vowel-initial
forms require an onset repair. The `roots.wli` file may contain generated phonotactic test words, so
its `*-itaru`-like outputs should be treated as sound-change feasibility rather than canonical
lexical attestation.

### Working Interpretation

The current working model is that `-iter` is the regular inherited reflex of an older onset-bearing
superessive or upper-surface marker, while `-itar` is the productive Early Hick superessive that
spread from a separate Seneran dialect layer.

```text
regular inherited reflex:
*ʔitaru / *hitaru > -iter

prestige or restored dialect form:
*-itaru > -itar
```

In the coastal and eastern trade standard, the productive ellative `-imris` became the clearer
marker for source, emergence, and outward motion. This likely caused inherited `-iter` to lose
productivity where it overlapped with ellative meanings. It survived mostly in inland, conservative,
domestic, or ritual vocabulary, such as `venuiter` and related forms.

The productive superessive `-itar` is best placed in Ranterg highland or eastern-slope prestige
speech. During the middle Early Hick period, the growing ritual and political importance of
Thrantorgral in the Ranterg Mountains may have carried this highland form into broader Early Hick
usage. Its meaning remained comparatively clear: "on, upon, atop, supported by; onto/upon with
motion verbs."

### Regional Model

The resulting Early Hick standard is not purely coastal. It is a layered contact variety:

```text
Eastern/coastal trade speech:
  -imris becomes the productive ellative

Western inland and agricultural speech:
  -iter survives in older fossilized forms

Ranterg highland prestige speech:
  -itar spreads as the productive superessive
```

Coastal Early Hick became the practical base of the standard because eastern and coastal communities
controlled the trade routes to the wider Beteran community. Ranterg speech then contributed prestige
religious or political forms after Thrantorgral gained importance.

The strongest dialectal drift should be expected in the most isolated Seneran regions. The Maltreks,
especially the remote northwestern highlands, are the best candidate for the most conservative or
divergent local speech. They likely remained marginal to island-wide standardization until rare
minerals made the region economically important late in the Early Hick period or later. Northeastern
Senera is a likely secondary isolation zone, because colder and less productive conditions would
have limited settlement density, trade intensity, and regular contact with the coastal standard.
This northeastern or Skelmark zone likely had little island-wide influence during the Early Hick
period. Its larger influence begins in Middle Hick, after the Iutlandish landing made it a base for
inland expansion. The inland Western Lowlands and eastern Rannek may also preserve local features
because of distance from the eastern maritime network, but their agricultural importance likely
created more regular trade contact. They should therefore be treated as conservative contact zones
rather than fully isolated dialect pockets. These regions may preserve older reflexes or develop
stronger local innovations than the eastern trade coast or the Ranterg prestige corridor.

One small confirmed Maltreks or upper Malter Valley split is the regional earthworm form `grapal`,
especially plural `grapales`, beside standard Early Hick `grapar`/`grapares`. This should be treated
as a local lexical variant, not as a general Early Hick liquid sound law. The form likely reflects
local liquid leveling in a familiar inherited compound:

```text
standard lexicalized compound:
gral-par > grapar "earthworm"

regional leveling:
grapar(es) > grapal(es)
```

The split fits the broader expectation that isolated western and mountain regions preserve local
reductions, but it should not be projected onto all `r/l` environments without further evidence.

This explains mixed formal expressions such as:

```text
'ilitar venuiteres
good-SUPE birth-ELL.DIAL-ABS
"blessings upon your birth"
```

Here, `'ilitar` uses the standard or prestige superessive, while `venuiter` preserves an older
inland/fossil birth term.

## Working Form: esp

The direct reconstruction `*espu > -esp` is currently weak. It produces the desired Early Hick
shape, but it looks more like a placeholder than a motivated Proto-Hick form.

A better working model derives `-esp` from a grammaticalized compound around `*wesu` and a probable
root `*pu`:

```text
*wesu pu
> wesp
> -esp
```

The likely older senses are:

```text
*pu = hole, hollow, burrow
*wesu = dwelling, enclosed space
     > enclosure
     > cover, enclose
```

The independent Early Hick root `wes` preserves the later lexical sense "cover, enclose." The
compound `*wesu pu` preserves a more spatial use: "enclosed hole, covered hollow, burrow-dwelling."
The important semantic development is:

```text
burrow-dwelling, covered hollow
> under-cover place, beneath a surface, under the ground
> subessive -esp "under, below, beneath"
```

This should not be treated as a fully formed Proto-Hick subessive. The best chronology is:

```text
Proto-Hick:
  *wesu pu = enclosed hole, burrow-dwelling

Maritime / Proto-Seneran:
  burrow sense weakens or broadens in island and maritime settings
  > covered hollow, ship hold, enclosed lower storage space,
    under-cover place

Pre-Hick:
  wesp = covered/beneath-place

Early Hick:
  root-wesp > root-esp
  -esp becomes the productive subessive case marker
```

This path fits the current Early Hick lexicon better than bare `*espu`. It also explains why `wesp`
could survive as a separate lexical relic: Maritime Hick could shift the older burrow or
covered-hole sense toward ship holds and enclosed lower storage spaces, while Early Hick later
generalizes the independent word to "cellar", "basement", or "lower enclosed space." It explains
`saresp` "sprout" as "leaf under/covered," with growth understood as emergence from concealment or
from beneath the ground. It also gives `aiesp` "bathe" a more concrete source: "water
covering/enclosing the body," rather than only abstract "water under."

Lexurgy currently gives:

```text
*wesu pu > wesp
*brisu-wesu-pu > brisesp
```

The second form is important because the current compound rules already allow `w` to disappear after
sibilants at a compound boundary. The phonotactics also do not allow general `Cw` onset clusters.
Once `wesp` was reanalyzed as a bound suffix, forms like `*imer-wesp`, `*sar-wesp`, or `*gral-wesp`
were therefore prone to repair as `imer-esp`, `sar-esp`, and `gral-esp`. This makes `wesp > esp`
plausible as a common-use reduction of a very frequent grammatical suffix: sibilant-final compounds
could surface with `-esp`, and consonant-final stems would independently favor loss of the weak
initial `w`. Speakers then generalized `-esp` as the productive subessive.

This should be treated as a common-use reduction and analogical leveling, not as a global sound
change deleting all `w` before `e`.

## Calibration Form: asam

The `asam` family is best treated as a shared-base reconstruction problem, not as a strictly
sequential derivation from a live Early Hick verb.

### Working Interpretation

The current Early Hick material supports three related but distinct outcomes:

```text
Proto-Hick:
*xasamu = rest, repose, resting place

Early Hick lexical noun:
asam = rest, resting place

Early Hick case marker:
-asam = sublative, downward / onto a lower surface
```

The most economical analysis is that the noun and the case marker are cognate developments from the
same older base. The case marker does not need to be synchronically derived from a live finite verb
such as `asam'er`. Instead, the grammaticalization path is better understood as:

```text
rest, resting place
> toward rest
> down into rest
> onto a lower or supporting surface
> sublative -asam
```

This fits the Early Hick lexical evidence better than a model where speakers first derive a verb "to
go to rest" and only later turn that verb into a case marker. If `asam'er` is later normalized or
explicitly documented, it can be treated as a transparent finite verbalization of the lexical base
`asam`, not as the historical source that speakers must reconstruct in order to understand `-asam`.

### Synchrony vs. History

Synchronically in Early Hick:

- `asam` is a lexical noun
- `-asam` is a productive grammatical case suffix
- forms such as `asamasam` and `asamitar` show later lexicalized derivations built from the
  noun-plus-case family

Historically:

- the noun and suffix are related
- but they should be treated as parallel outcomes of older `*xasamu` material, not as a simple live
  chain `asam > asam'er > -asam`

## Open Questions

- Does Apgarian preserve a form closer to `*lawesu`?
- Does Maritime preserve `*lahesu`, `*laʔesu`, or a separate inward marker behind fossil `-aes`?
- Does Apgarian or Maritime preserve an `imeris`-like form before the productive Early Hick
  reduction to `imris`?
- Is the exterior/source sense of `*-isu` inherited from Proto-Hick, or is it a
  Proto-Maritime/Proto-Seneran contextual development?
- Does Early Hick `kiris` come from `*kiru-risu` "reed body", and did that meaning develop through
  plantlike fey contact?
- Is `-itar` specifically a Ranterg highland prestige form, or did the same restored superessive
  survive in multiple Seneran regions?
- Which stage first developed productive spatial case suffixes?
- Are `duwes`, `ewes`, and `-las` part of one derivational family, or do they reflect separate
  lexical and grammaticalized branches?
- Does `*pu` survive elsewhere with the sense "hole, hollow, burrow", or only in the bridge form
  `wesp`?
