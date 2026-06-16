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

## Proto-Hick Morphosyntax Working Hypothesis

Do not assume that Proto-Hick already had the full Early Hick case system. Most documented Early
Hick case marking is better treated as a later Seneran development or grammaticalization layer.
When reconstructing Proto-Hick, start from looser morphosyntax:

- action nouns or event words
- discourse particles
- postpositions or clitic-like relation markers
- serial predicates or predicate chains
- pragmatic word order and context
- optional responsible participants rather than obligatory ergative marking

Early Hick may preserve older discourse habits while expressing them through newer case suffixes.
For example, a later Early Hick pattern such as "absolutive event + ergative responsible agent" may
reflect an older pragmatic shape:

```text
named event + responsibility/agent phrase
```

rather than an inherited Proto-Hick ergative-absolutive sentence frame.

This is especially important for commands, requests, possession, spatial relations, and clause
linking. Proto-Hick may have had the beginnings of these functions through particles and discourse
structure before later daughter branches turned them into case suffixes, verbal suffixes, or fixed
auxiliaries. Future Apgarian, Maritime, and Seneran comparative work should test whether a function
is inherited as:

- a lexical root
- a particle or postposition
- a word-order/pragmatic construction
- a later branch-specific case marker or suffix

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

Plain `*lawesu` currently behaves best as a lexical root: "consume, take in, use, eat." It can
support fossilized compounds such as `ewes` when combined with the older comitative-instrumental
particle `*ʔelu`.

The related but distinct `*wesu` branch covers "cover, enclose; enclosed space" and better explains
`wesp`, `-esp`, `brises`, and `duwes`-type compounds.

The form `*lahesu` currently produces `las`. This makes it a strong candidate for a later
grammaticalized allomorph that became the productive Early Hick illative suffix `-las`.

The form `*laʔesu` produces apostrophe-bearing `-'es` shapes. This may belong with archaic or
fossilized inward/receptive forms, but it should not be treated as productive Early Hick morphology.

### Provisional Analysis

```text
Proto-Hick:
*lawesu = consume, take in
*ʔelu-lawesu = consume/take in together > ewes
*wesu = cover, enclose

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

## Working Form: pe, mope, penar

Proto-Hick likely had an inherited negative or refusal particle distinct from the later Seneran
darkness and evil negation cluster:

```text
*pe = no!, refusal!
```

This root should not be derived from `*muru` "night, darkness" or `*ʔimu` / `imur` "evil,
harmful force." It belongs instead to an older expressive refusal layer: a short, bodily negator
associated with refusing food, touch, command, or expected action.

In Seneran Early Hick, productive negation is supplied by `mo-`, while `*pe` survives in fossilized
and child-directed forms:

```text
*pe        > pe      "no!" (childish, petulant, or teasing refusal)
mo-pe      > mope    "no" (ordinary standalone negative answer)
*pe naru   > penar   "inaction, refusal to act, sulking non-action"
*peka      > pek     "refusal, denial" (bound or lexicalized stem)
*peka heru > peker   "to refuse, deny"
pe-ok      > pekok   "naysayer, habitual refuser; idler"
```

The form `mope` should be treated as reinforced negation or negative concord, not as a logical
double negative. The newer Seneran negative `mo-` reinforces the older inherited refusal particle
`pe`, producing the normal standalone negative answer. This lets Early Hick keep `mo-` as the
productive clausal and derivational negator while still preserving an older Proto-Hick negative
root in everyday speech.

The `pe` family gives Early Hick a small register of childish or socially marked refusal:

- `pe!` "no!" in child speech, petulant refusal, or teasing adult imitation
- `penar` "inaction; refusal to act; sulking non-action"
- `peker` "to refuse, deny"
- `pekok` "naysayer; habitual refuser; by extension, an idle or unskilled person perceived as
  refusing expected work"

These forms should remain lexical fossils. They do not make `pe-` a productive Early Hick negation
prefix.

## Working Form: ig, ignar, nater

The affirmative and desiderative clusters should be kept related through `*naru`, but not derived
from the same immediate form.

### Affirmative and Correctness

The current best reconstruction for Early Hick `ignar`, `gnar`, and `nar` is:

```text
*ʔiga = correct, fitting, true
*naru = action, deed, enacted response

*ʔiga naru = correct action, fitting response
> ignar [ignər]
> gnar
> nar
```

Current Lexurgy output supports the first step:

```text
ʔiga      > ig
ʔiga naru > ignər
naru      > nar
```

Early Hick preserves `ignar` as the visible full-form reflex of the older formula, but its primary
living sense is "fit, accord with an established pattern or norm." This keeps the link to `naru`
and to the clipped ordinary form `gnar` visible without making `ignar` the normal standalone "yes."
The form `gnar` is the common affirmative and correctness term, while `nar` is an informal clipped
affirmative, similar to English "yup." The older `*gnaru` reconstruction should be retired unless
comparative evidence later requires a separate root.

The `ig` element may become useful as a Hickic sound-symbolic marker of correctness, fittingness,
or truth. At present this should be treated as a promising reconstruction clue, not as a proven
productive sound-symbolic rule across the family.

### Desiderative and Intended Course

The desiderative is cleaner if it comes through an early lexicalized `*nateru`, from transparent
`*naru teru`, rather than directly from `gnar-ter`:

```text
*naru teru = action-flow, course of action
> *nateru
> nater
> intended course, desired outcome
> desire, intention
> nat-'er by reanalysis with productive -'er
> -nat
```

This keeps the semantic bridge natural:

```text
flow of action
> course of action
> intended course
> desired outcome
> desire, intention
```

This also gives the meaning enough time to settle before `-nat` becomes productive. A transparent
late compound `naru teru` currently yields `narter` in Lexurgy, while already-fused `nateru` yields
`nater`, so the desired form is better treated as an earlier lexicalized stem.

The related form `gnater` can remain in Early Hick as a correctness-colored analogical variant.
It likely began as `gnar-ter` "correct flow, fitting course" after `gnar` had lexicalized as
"correct; yes." Because it sits beside `nater`, it can pick up a secondary desire/intention sense
where the desired thing is understood as fitting, proper, or rightful. It is not the direct source
of the productive suffix `-nat`.

## Request and Command Reconstruction Notes

### Early Hick Requestive naterlas

Early Hick can grammaticalize a soft requestive from `nater-las`:

```text
nater-las = desire/willingness-ALL
> naterlas "toward willingness"
> polite requestive, "please; would you be willing to..."
```

This should not be reconstructed as a Proto-Hick request marker. The allative `-las` belongs to the
later Seneran spatial case system. What may be older is the pragmatic construction discussed above:
a requested action is treated as a named event, then combined with a particle or predicate of
desire, correctness, negation, or responsibility. Early Hick expresses that older discourse pattern
with its newer case morphology:

```text
ACTION-es!                         direct event call
ACTION-'er-es nater AGENT-el       willingness request
ACTION-'er-es naterlas AGENT-el    soft requestive
ACTION-'er-es ignar'er AGENT-el    obligation / fittingness request
```

For Proto-Hick and early branch reconstruction, prefer reconstructing roots and particles relevant
to the construction, such as `*naru`, `*teru`, `*nateru`, `*ʔiga`, `*pe`, and whatever earlier
negative particles were active.

### Request-Specific Branch Comparison

When reconstructing Proto-Hick or early branch daughters, use the Early Hick request system as
evidence for discourse patterns, not as direct evidence for inherited case morphology.

The likely inherited pattern is:

```text
named action/event + discourse particle or predicate + optional responsible participant
```

Early Hick realizes this through absolutive event calls and later Seneran case marking. Other
Hickic branches may instead preserve older particles, postpositions, serial verbs, or looser action
noun constructions. This gives several comparative predictions to test once Apgarian, Maritime, and
other Seneran descendants are developed:

- If another branch has a requestive particle cognate with `nater` or `*nateru`, then Early Hick
  `naterlas` may be a Seneran renewal of an older Hickic willingness-request strategy.
- If another branch uses a correctness or fittingness predicate for advice and obligation, compare
  it with Early Hick `ignar'er` and the proposed `*ʔiga naru` correctness formula.
- If another branch has bare action nouns or event words as commands, that supports reconstructing
  an older "event call" imperative strategy without reconstructing Early Hick `-es`.
- If another branch marks the responsible doer in commands with a particle or postposition rather
  than an ergative suffix, compare its function with Early Hick targeted imperatives like
  `vinud-es, Aigral-el!`.
- If another branch has a special prohibitive particle, compare it against Early Hick
  `mo-ACTION-'er!` and `ACTION-es mo'er!`. Early Hick may have renewed prohibition through its
  productive `mo-` negation, while older Hickic may have used a separate negative command marker.
- If another branch expresses beneficiary through possession rather than a benefactive case, compare
  it with Early Hick request phrases such as `tan-ul vinud` "one's own dwelling."

## Working Form: medial demonstratives

The Early Hick medial direct pair is layered rather than a simple inherited animate/inanimate pair.
The inanimate or default form is inherited:

```text
Proto-Hick *ena "that, there in shared attention"
  > Early Hick -en MED.DIR.INAN/default
```

An inherited animate counterpart either merged with `-en`, was lost, or became too opaque to
maintain the animate distinction. Early Hick then renewed the animate medial direct form through
Princely Channel contact:

```text
Old Chemise tan "sibling, comrade"
  > Princely Maritime tan "comrade, crewmate"
  > Early Raibonian / Maritime Lingua Franca tan
     "that known person, that fellow there"
  > Early Hick -tan MED.DIR.ANIM
```

This keeps `-tan` out of the core Proto-Hick demonstrative inventory while explaining why it is so
strongly animate and socially direct in Early Hick. It also leaves `tan` available as an ordinary
borrowed/contact stem meaning "comrade, associated person, one of one's own side"; in phrases like
`tan-ul vinud`, `-ul` is still the regular possessive marker.

The medial indirect pair is layered in a different way. The inanimate/default form appears
inherited:

```text
Proto-Hick *etha "that hidden, sensed, or indirectly available thing"
  > Early Hick -eth MED.INDIR.INAN/default
```

The animate indirect form can be explained as a native renewal from lexical `thir` "air, wind."
Since wind is an unseen moving force, `thir` could extend to unseen presences before becoming a
bound animate indirect demonstrative:

```text
thir "air, wind; unseen moving force"
  > thir "unseen animate or agentive presence"
  > Early Hick -thir MED.INDIR.ANIM
```

This also explains why lexical `thir` narrows toward "air" in ordinary use while `bressim` becomes
the regular word for wind as a weather event or gust.

## Working Form: distal demonstratives

The distal pair is the most conservative part of the Early Hick demonstrative system:

```text
Proto-Hick *ʔuma "that distant thing"
  > Early Hick -um DIST.INAN/default

Proto-Hick *ruma "that distant animate one"
  > Early Hick -rum DIST.ANIM
```

Current Lexurgy rules support these direct paths:

```text
ʔuma > um
ruma > rum
```

They do not directly support `hi + ʔuma > rum`; such forms produce an initial `i` or glottal trace
instead. If the `r-` of `*ruma` reflects older animacy morphology, that effect must already predate
Proto-Hick proper. A plausible deeper note is that pre-Proto-Hick `*hi + *ʔuma` produced or
preserved a rhotic animate-deictic linker, but by Proto-Hick `*ʔuma` and `*ruma` were separate
stems.

### Lexicalized Compound Smoothing

Forms such as `gnater` and `thragral` suggest a tendency for lexicalized compounds to smooth heavy
or redundant boundary material after speakers stop feeling the internal boundary clearly:

```text
gnar-ter > gnater
thral-gral > thragral
```

This should not be encoded as a broad Lexurgy sound law yet. It is a case-by-case lexicalization
tendency affecting high-frequency, culturally important, or semantically opaque compounds.

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

A better working model derives `-esp` from a grammaticalized compound around `*wesu` and the
locative/interior particle `*pu`:

```text
*wesu pu
> wesp
> -esp
```

The likely older senses are:

```text
*pu = at, in, within; interior place
*wesu = dwelling, enclosed space
     > enclosure
     > cover, enclose
```

The independent Early Hick root `wes` preserves the later lexical sense "cover, enclose." The
compound `*wesu pu` preserves a more spatial use: "within an enclosure, enclosed interior,
covered place."
The important semantic development is:

```text
enclosed interior, covered place
> under-cover place, beneath a surface, under the ground
> subessive -esp "under, below, beneath"
```

This should not be treated as a fully formed Proto-Hick subessive. The best chronology is:

```text
Proto-Hick:
  *wesu pu = within an enclosure, enclosed interior

Maritime / Proto-Seneran:
  enclosed-interior sense broadens in island and maritime settings
  > covered interior, ship hold, enclosed lower storage space,
    under-cover place

Pre-Hick:
  wesp = covered/beneath-place

Early Hick:
  root-wesp > root-esp
  -esp becomes the productive subessive case marker
```

This path fits the current Early Hick lexicon better than bare `*espu`. It also explains why `wesp`
could survive as a separate lexical relic: Maritime Hick could shift the older enclosed-interior
sense toward ship holds and enclosed lower storage spaces, while Early Hick later
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

The same locative/interior `*pu` also helps explain `dup`:

```text
*duha pu
> *duhapu
> dup
```

Here `*duha` contributes "meat, flesh" and `*pu` contributes "inside, interior." The lexicalized
compound therefore means "thing within flesh; internal concretion," which gives Early Hick `dup`
"pearl; lump, mass" a better source than older `dupu`-style placeholder forms. The form should be
treated as a lexicalized compound before regular reduction, not as a fully transparent productive
phrase.

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

## Coordination Particles

Early Hick coordination currently preserves at least four historical layers:

```text
Proto-Hick *ho
> Early Hick o

Proto-Hick *storu "grow, increase"
> Early Hick stor "growth, addition, increment"
> clipped/grammaticalized Early Hick ru "and"

Proto-Hick *ʔaha "other, another; alternative"
> Early Hick 'a "or"
> Early Hick 'atil "'a + 'etil, other one; alternative"

Proto-Hick *ʔelu lawesu "consume/take in with"
> Early Hick ewes "together with; together"
```

The Lexurgy path supports `*ho > o`, so the bare Early Hick enumeration particle does not need to
come from a vowel-initial Proto-Hick form. `*ʔo` also yields `o`, but `*ho` better respects the
current Proto-Hick preference for onset-bearing simple particles while explaining the weak onset's
loss in Early Hick.

The additive coordinator `ru` should not be treated as the regular direct reflex of `*storu`, since
`*storu` yields `stor`. Its best current analysis is grammatical clipping from the same additive
semantic family as `stor`: "grow, increase" > "addition, increment" > "and, plus." This makes `ru`
a later Pre-Hick or Early Hick coordinator shaped by repeated use in `o...ru` list frames.

The disjunctive coordinator `'a` is the grammaticalized reflex of Proto-Hick `*ʔaha` "other,
another; alternative." Synchronically, bare `'a` is chiefly a coordinator in `o...'a` list frames,
but the older alterity sense is preserved through the lexicalized compound `'atil` (< `'a` +
`'etil` "living thing, entity"). Corrective expressions such as "not that person, the other one"
provide a natural bridge from contrastive alterity into the ordinary lexical sense "other,
different thing; alternative."

The shared-action coordinator `ewes` is older and more securely phonological. The tested path
`*ʔelu lawesu > ewes` supports the existing analysis where older comitative-instrumental `*ʔelu`
survives in fossilized compounds and coordinators. Synchronically, `ewes` behaves like a particle
that can take case for a coordinated group, but diachronically it belongs to the same fossil layer
as other `*ʔelu` compounds rather than to the newer productive ergative `-el`.

This alterity/disjunction family should remain distinct from the `haran` / `'iran` / `ran` /
`ran-` family. `*ʔaha > 'a` concerns alternatives and choice, while the `haran` family concerns
physical or conceptual division, partition, and exclusive part-whole structure.

## Division and Partitive Doublets

The `haran` / `'iran` / `ran` / `ran-` family should not be treated as a simple direct inheritance
from Proto-Hick `*haranu` through the regular Seneran sound-change pipeline.

Lexurgy currently predicts the following regular Seneran outcomes:

```text
*haranu
> Early Hick thren/thrən

embedded *... haranu
> Early Hick ...rən

*ʔiharanu or *hiharanu
> Early Hick iren/irən
```

This means ordinary inherited Seneran material does not directly yield lexical `haran`, nor does it
cleanly explain all uses of `ran`. The better working analysis is a doublet family from mainland
Hickic contact:

```text
older naturalized mainland Hickic borrowing:
'iran = bifurcation point; branching divide in flowing water
> ran = stream, brook; one branch of the divided flow
> ran- = partitive, generalized from "divided portion/share"
> telran- = exclusive partitive, tel- "end, limit" + ran-

later learned mainland Hickic reborrowing:
haran = split, separate; divide a whole object; divide mathematically
```

Under this model, lexical `ran` and grammatical `ran-` are related but not sequentially derived from
one another. `ran` narrows the hydrological sense of `'iran` to the flowing branch after a fork,
while `ran-` grammaticalizes the same division/share sense into partitive morphology. Later `haran`
is a more conservative or learned mainland Hickic form, useful for physical division of a whole and
for mathematical division.

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
