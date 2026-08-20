# Mortality Phases and Experiential Age Design

## Goal

Replace flat character mortality and birth/death date metadata with an ordered mortality-phase model
that can represent living, undead, revived, and reincarnated lives. Derive the sidebar's ordinary
`Age` value from cumulative existence time, preserve authored `age` as a fallback when dated
evidence is incomplete, and let readers expand the Age row into a compact mortality history.

The design must handle the concrete Bastion Falls cases that exposed the flat model's limits:

- Narmaya died and immediately became a vampire;
- Oscar died and became a revenant on the same day;
- Lord Boyle remained dead long enough to decompose before becoming a zombie;
- Jarvid became a revenant and later returned to life through *true resurrection*;
- future characters may be reincarnated into a different species while retaining identity.

## Scope Boundary

This design models an identity's mortality state and cumulative existence. It does not model which
physical body that identity occupies.

Body displacement, soul transfer, possession, vessel provenance, physical/body age, and apparent age
are explicitly deferred. Minfilia's transfer from her original body into Sofia's preserved cadaver
remains prose canon for now, and her authored `age: 16` remains a fallback rather than forcing the
mortality model to become an embodiment ontology.

## Authored Schema

`character.details.mortality` becomes an object:

```yaml
mortality:
  status: alive
  phases:
    - type: birth
      from: 1200-01-01 AI
      to: 1275-09-10 AI
      species: human

    - type: undeath
      from: 1275-09-11 AI
      to: 1275-09-18 AI
      species: revenant

    - type: revival
      from: 1275-09-18 AI
      method: true resurrection
      species: elf
```

### Current status

`status` is the authoritative current state and remains a closed enum:

```text
alive | dead | undead | unknown
```

`unknown` remains valid when history is partly known but present condition is not.

### Ordered phases

`phases` is an ordered array, not a keyed object. Array order preserves repeated death, undeath,
revival, and rebirth cycles without invented keys such as `undeath2`.

Phase `type` is a closed enum with exactly four initial values:

```text
birth | undeath | revival | rebirth
```

The phase meanings are:

- `birth`: the original living existence;
- `undeath`: a continuous undead existence;
- `revival`: restoration of the same life through resurrection or equivalent magic;
- `rebirth`: a genuinely new embodied life, such as reincarnation.

All phases accept:

```ts
{
  from?: string;
  to?: string;
  species?: string;
}
```

Authored dates remain strings. Runtime code parses them to `BastionDate`; content schemas do not
expose `string | BastionDate` unions.

`species` is an open descriptive string, not an enum and not a discriminator. It may appear on every
phase to preserve species changes across reincarnation. An `undeath` phase requires a non-empty
`species`; other phase types make it optional.

`revival` and `rebirth` additionally accept an optional open `method` string:

```yaml
- type: revival
  method: true resurrection

- type: rebirth
  method: reincarnate
```

The phase type distinguishes restoration from a new birth. Renderers do not inspect `method` to
infer that distinction.

### Existing character fields

The migration removes authored flat:

- `character.details.dateOfBirth`;
- `character.details.dateOfDeath`;
- scalar `character.details.mortality`.

`character.details.age` remains an optional authored fallback. It does not override a complete,
valid phase-derived age.

`character.details.species` retains its existing schema and remains the character's current/general
classification for existing consumers. Phase-level `species` preserves lifecycle-specific or
historical forms and does not replace the general field in this change.

## Phase and Status Validation

The schema uses a discriminated union on phase `type` and validates structural requirements locally.
A second validation layer reports lifecycle contradictions when the available evidence is precise
enough to prove them.

Validation rules:

1. `undeath.species` must be a non-empty string.
1. `from`, `to`, and `method`, when present, must be non-empty strings.
1. A phase with comparable boundaries must not end before it begins.
1. Fully comparable phases must not overlap or run backward in authored order.
1. `status: undead` requires at least one `undeath` phase. When the latest phase has known
   open/closed bounds, the latest open phase must be `undeath`.
1. When an `alive` record has enough information to establish an open latest phase, that phase must
   be `birth`, `revival`, or `rebirth`.
1. When a `dead` record has enough information to establish phase closure, it must not contain a
   later open existence phase.
1. Empty and incomplete phase arrays remain valid for `alive`, `dead`, and `unknown`; `status` is
   authoritative when history is sparse.
1. Validation must not invent dates, infer missing transitions, or reject a record merely because
   its historical sequence is incomplete.

Adjacent gaps are meaningful dead intervals. They are not authored as `dead` phases:

```text
previous phase.to -> next phase.from
```

A same-date death and undeath may produce no meaningful dead interval. A later undeath date
preserves a measurable period spent dead.

## Age Semantics

The sidebar's ordinary `Age` means cumulative existence age: the sum of time spent in all measurable
`birth`, `undeath`, `revival`, and `rebirth` phases. Dead gaps between phases do not contribute.

For a character who lived twenty years, remained dead for two years, and then existed as a skeleton
for two years:

```text
existence age = 20 living years + 2 undead years = 22
chronological span = 24 years
```

The sidebar shows `Age: 22`. This design does not add a second chronological-span field.

### Phase bounds

For each phase:

- a closed phase uses `from -> to`;
- the latest open phase uses `from -> current campaign date` when its state agrees with `status`;
- a missing required phase boundary makes complete phase-derived Age unavailable;
- missing boundaries in dead gaps do not matter because dead gaps are excluded.

A current `dead` character sums completed existence phases and does not accrue age after the final
phase ends.

### Exact and approximate arithmetic

- Day-precision boundaries use `BastionDate.epochDay`/`until()` and contribute exact elapsed days.
- Partial boundaries downgrade the phase calculation to the coarsest precision shared by its bounds,
  produce a deterministic estimate from the known calendar fields, and mark the phase approximate.
- If any contributing phase is approximate, total Age is approximate and renders with `~`.
- Missing or malformed contributing boundaries prevent complete derivation rather than yielding a
  plausible-looking partial total.
- Exact phase durations are accumulated before converting cumulative existence to completed calendar
  years, so several partial-year phases can together produce another completed year.

The implementation must use `@bastion-falls/calendar` definitions and arithmetic rather than
assuming Gregorian month or year lengths.

### Authored fallback

Resolution order is:

1. return a complete valid phase-derived Age when available;
1. otherwise return authored `details.age` when present;
1. otherwise omit Age.

This preserves Fawn's uncertain but authored age and Minfilia's current body-oriented age while
letting complete records remain live and calendar-derived.

## Sidebar Interaction

The ordinary sidebar remains compact and displays only `Age` by default. When phase history exists,
the Age value is a keyboard-accessible disclosure control implemented with semantic HTML rather than
a hover-only popover.

The approved presentation is an inline disclosure directly beneath the Age row. It does not add a
separate always-visible Mortality section and does not use a floating popover.

Example expanded Narmaya presentation:

```text
Age    ~414

Born · 861 AI
Human · lived for ~13 years

Became undead · 874 AI
Vampire · undead for ~401 years
```

Presentation strings are centralized mappings from phase type and open/closed state:

- `birth`: `Born`, `Lived for`, or `Alive for`;
- `undeath`: `Became undead`, `Was undead for`, or `Undead for`;
- `revival`: `Revived`, `Lived again for`, or `Alive again for`;
- `rebirth`: `Reborn`, `Lived this life for`, or `Living this life for`.

`species` renders separately as authored, without automatic indefinite articles. The generic
renderer uses `Became undead` plus `Vampire`, not generated prose such as `Became a vampire`; this
avoids incorrect `a`/`an`, plural, proper-name, and collective-name handling.

`method` renders separately as `Via {method}` with display casing, not as part of a generated
sentence. Character prose remains the place for more natural or character-specific wording.

The disclosure is rendered only when meaningful phase history is available. Age without phase
history remains plain text.

## Derived Model

The resolver may expose normalized phase results rather than making the Astro component repeat date
logic:

```ts
interface ResolvedMortalityPhase {
  type: "birth" | "undeath" | "revival" | "rebirth";
  from?: BastionDate;
  to?: BastionDate;
  species?: string;
  method?: string;
  duration?: CalendarDuration;
  approximate: boolean;
  open: boolean;
}

interface ResolvedCharacterAge {
  value: number;
  approximate: boolean;
  source: "phases" | "authored";
  phases: readonly ResolvedMortalityPhase[];
}
```

The exact public names may follow neighboring module conventions during implementation, but the
component receives one normalized result with value, provenance, approximation, and phase details.
It does not parse dates itself.

## Content Migration

The migration is content-wide but mechanical for ordinary characters:

- living/unknown with DOB: one open `birth` phase;
- dead with DOB/DOD: one closed `birth` phase;
- records with partial dates preserve those strings unchanged;
- authored age remains where phase evidence is insufficient;
- flat date and mortality fields are removed once represented by the object.

The four known undead/current-or-historical cases receive adjudicated migrations:

### Narmaya

```yaml
mortality:
  status: undead
  phases:
    - type: birth
      from: 861-01-01 AI
      to: 874 AI
      species: human
    - type: undeath
      from: 874 AI
      species: vampire
```

Her imprisonment remains a separate timeline event in 982 AI.

### Oscar Savoy

```yaml
mortality:
  status: undead
  phases:
    - type: birth
      from: 1241-06-13 AI
      to: 1275-08-09 AI
      species: human
    - type: undeath
      from: 1275-08-09 AI
      species: revenant
```

### Lord Boyle the Undead Horse

```yaml
mortality:
  status: undead
  phases:
    - type: birth
      to: 1275-08-25 AI
    - type: undeath
      from: 1275-09-09 AI
      species: zombie
```

The gap records approximately fourteen days spent dead before Minfilia raised him.

### Jarvid Skelwick

```yaml
mortality:
  status: alive
  phases:
    - type: birth
    - type: undeath
      from: 1275-09-11 AI
      species: revenant
    - type: revival
      method: true resurrection
      species: elf
```

The unknown resurrection date remains absent. His current Age therefore continues to require
authored fallback or omission until enough phase evidence is recovered.

A migration script or bounded codemod may perform the ordinary conversion, but authored output is
the source of truth. Generated timeline output is regenerated by the existing integration rather
than hand-edited.

## Audit Changes

`bfcli calendar audit-ages` becomes phase-aware:

- report complete phase-derived ages;
- report matching and conflicting authored fallbacks when complete derivation exists;
- report insufficient precision separately from missing phase bounds;
- report malformed dates and provably invalid phase order;
- include approximation and derived-source metadata in JSON output;
- preserve a category for records with no sufficient derivation evidence.

The audit must not treat an intentionally authored fallback as invalid merely because its supporting
phase history is incomplete.

## Testing Strategy

Tests should protect stable boundaries without building a duplicate mortality engine in fixtures.

1. Shared schema tests cover the discriminated phase union, closed phase/status enums, required
   undeath species, optional open method, incomplete valid records, and obvious lifecycle
   contradictions.
1. Focused resolver tests cover:
   - ordinary living and dead characters;
   - same-date death/undeath;
   - dead gaps excluded from Age;
   - repeated undeath/revival/rebirth phases;
   - exact cumulative intervals crossing a completed-year boundary;
   - partial-date approximation propagation;
   - malformed and missing phase boundaries;
   - authored fallback only when complete derivation is unavailable;
   - zero ages and zero-duration phases.
1. Audit tests cover phase-aware categories and JSON evidence without duplicating all resolver
   cases.
1. Astro component/build checks verify:
   - Age remains the only collapsed label;
   - disclosure semantics are keyboard accessible;
   - Narmaya renders approximate phase history;
   - Oscar renders exact dates;
   - ordinary characters remain compact;
   - authored fallback characters render without a false phase history.
1. Run focused package tests while iterating, then types/schema checks, CLI tests/build, Astro
   tests, Astro diagnostics, the offline production build, formatting, and `git diff --check`.

## Explicit Exclusions

This change does not model:

- body displacement or vessel ownership;
- soul location, division, possession, or transfer;
- physical, apparent, or body age;
- Minfilia/Sofia embodiment history;
- consciousness, dormancy, imprisonment, petrification, or subjective awareness;
- arbitrary custom phase types beyond the four approved enum members;
- generated English articles or species-specific sentence templates;
- a separate chronological-span field;
- generalized identity-history or name-change events.

## Acceptance Gates

The feature is complete when:

1. Character schema accepts the approved mortality object, and a repository audit confirms no
   obsolete scalar mortality or flat birth/death date fields remain in authored character details.
1. All authored character content has migrated without losing partial dates or intentional age
   fallbacks.
1. Phase-derived Age sums existence phases, excludes dead gaps, and propagates approximation.
1. Narmaya, Oscar, Lord Boyle, and Jarvid represent their settled lifecycle canon without embodiment
   invention.
1. The collapsed sidebar still shows only `Age`; characters with meaningful history can expand it
   into the approved compact timeline.
1. The audit reports zero unexplained authored/derived conflicts and identifies incomplete evidence
   honestly.
1. Focused schema, resolver, audit, and rendering checks pass, followed by the repository's relevant
   CLI/Astro verification and offline production build.
1. No body-displacement or soul-vessel model enters this implementation.
