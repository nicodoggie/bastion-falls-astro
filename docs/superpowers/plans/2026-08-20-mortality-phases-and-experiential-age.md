# Mortality Phases and Experiential Age Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task by task, with
> spec-compliance review before code-quality review.

**Goal:** Replace flat character mortality dates with ordered existence phases, derive cumulative
existence Age with authored override precedence, migrate all character content safely, and add the
approved expandable sidebar history.

**Architecture:** `@bastion-falls/types` owns the world-facing Zod schemas, normalized mortality
resolver, date-anchor helpers, and age arithmetic while depending one-way on the pure
`@bastion-falls/calendar` package. Astro and `bfcli` consume that single engine. The contract
cutover is atomic across authored content and all flat-date consumers so no committed boundary
leaves the site half migrated.

**Tech Stack:** TypeScript 6 ESM, Zod 4, `@bastion-falls/calendar`, Node 24's test runner, Stricli,
Astro 7, MDX/YAML frontmatter, rumdl, Biome, pnpm workspaces, and Turbo.

**Authoritative design:**
[2026-08-20-mortality-phases-and-experiential-age-design.md](../specs/2026-08-20-mortality-phases-and-experiential-age-design.md)

**Clean baseline:** `fa8f5859` on `feat/calendar-age-cleanup`. This commit already settles Uther and
Narmaya's pre-migration canon and leaves the worktree clean.

---

## Global Constraints

- Work from `/home/ensu/.cache/hermes-worktrees/bastion-falls-calendar`.
- Preserve `@bastion-falls/calendar` as provider- and character-domain-neutral. The calendar package
  must not import character schemas or Astro/CLI code.
- Put the mortality schema and resolver beside world character types in `@bastion-falls/types`; do
  not implement separate Astro and CLI arithmetic.
- Authored YAML dates remain strings. Programmatic resolver inputs may accept
  `string | CalendarDate` and must reject dates not bound to `bastionCalendar`.
- Keep `details.age` as an authored override. It wins the displayed total even when phases derive a
  different value; derived phase evidence remains available to the audit and disclosure.
- Phase type stays the closed set `birth | undeath | revival | rebirth`.
- `mortality.status` stays `alive | dead | undead | unknown`.
- Phase `species` stays an open single string; it is required only for `undeath`.
- Do not model bodies, vessels, soul transfer, apparent age, Minfilia/Sofia embodiment, possession,
  or identity-name history.
- Do not add a generalized migration framework or permanent compatibility parser solely for this
  one-time cutover.
- Preserve frontmatter formatting and unrelated prose. Avoid full YAML reserialization of 540 MDX
  files.
- Use exact behavior tests for schema/arithmetic/audit. Use bounded semantic scans, schema sync, and
  rendered-route checks for the mass content migration rather than one snapshot per file.
- Commit only at verified boundaries. Do not push without Nico's separate approval.

## Planned File Map

### Shared world schema and resolver

- Create `packages/types/src/CharacterMortality.ts`.
- Create `packages/types/src/CharacterAge.ts`.
- Create `packages/types/test/CharacterMortality.test.ts`.
- Create `packages/types/test/CharacterAge.test.ts`.
- Modify `packages/types/src/Character.ts` during the atomic cutover.
- Modify `packages/types/src/index.ts` only if root exports are useful; wildcard subpath exports
  already expose built modules.
- Modify `packages/types/package.json` to add the calendar workspace dependency and a real test
  script.
- Modify `pnpm-lock.yaml` through `pnpm install`.

### CLI and generated-content consumers

- Modify `cli/src/commands/calendar/audit.ts`.
- Modify `cli/src/commands/calendar/audit.test.ts`.
- Modify `cli/src/commands/kingraph/impl.ts`.
- Modify `cli/src/commands/migrate/functions/character.ts`.
- Modify `cli/src/commands/new/character/command.ts` only if flag help needs clarification.
- Modify `cli/src/commands/new/character/impl.ts`.
- Modify `cli/templates/character.ejs`.
- Create temporary migration files under `cli/scripts/`, then remove them before the migration
  commit.

### Astro

- Modify `astro/src/lib/timeline.ts`.
- Delete `astro/src/lib/character-age.ts` after all consumers use the shared resolver.
- Delete or migrate `astro/src/lib/character-age.test.ts` into shared package tests.
- Create `astro/src/components/sidebar-info/CharacterAgeDetail.astro`.
- Create `astro/src/components/sidebar-info/characterAgeDetail.ts`.
- Create `astro/src/components/sidebar-info/characterAgeDetail.test.ts`.
- Modify `astro/src/components/sidebar-info/CharacterSidebarInfo.astro`.

### Authored content

- Mechanically migrate direct character frontmatter under
  `astro/src/content/docs/world/characters/**/*.mdx`.
- Do not hand-edit `astro/src/content/docs/world/timeline/timeline-generated.mdx`; it is generated
  and ignored. Regenerate it through Astro checks/builds.

---

## Task 1: Add Standalone Mortality Schemas

**Objective:** Define and test the approved mortality object without changing
`CharacterDetailsSchema` or authored content yet.

**Files:**

- Create: `packages/types/src/CharacterMortality.ts`
- Create: `packages/types/test/CharacterMortality.test.ts`
- Modify: `packages/types/package.json`
- Modify: `pnpm-lock.yaml`

### Step 1: Add the package test command and calendar dependency

Modify `packages/types/package.json`:

```json
{
  "scripts": {
    "test": "node --import tsx --test test/**/*.test.ts"
  },
  "dependencies": {
    "@bastion-falls/calendar": "workspace:^",
    "zod": "~4.3.6"
  }
}
```

Run:

```bash
pnpm install
```

Expected: workspace links and lockfile update without unrelated dependency churn.

### Step 2: Write schema RED tests

Create `packages/types/test/CharacterMortality.test.ts` covering:

- accepted `status` values and rejected unknown statuses;
- accepted phase types and rejected custom phase types;
- required non-empty `undeath.species`;
- optional non-empty `from`, `to`, `species`, and return `method`;
- `method` rejected on `birth` and `undeath`;
- empty/incomplete phase arrays for known sparse records;
- repeated revival/rebirth/undeath phases;
- obvious comparable `to < from` and overlapping day-precision ranges;
- `status: undead` without any undeath phase rejected;
- incomplete history not rejected merely for missing dates.

Representative assertions:

```ts
assert.equal(
  CharacterMortalitySchema.safeParse({
    status: "undead",
    phases: [{ type: "undeath", species: "vampire", from: "874 AI" }],
  }).success,
  true,
);

assert.equal(
  CharacterMortalitySchema.safeParse({
    status: "undead",
    phases: [{ type: "undeath", species: "" }],
  }).success,
  false,
);
```

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/types test
```

Expected: FAIL because the new module does not exist.

### Step 3: Implement the discriminated union

Export from `CharacterMortality.ts`:

```ts
export const MortalityStatusSchema = z.enum([
  "alive",
  "dead",
  "undead",
  "unknown",
]);

export const MortalityPhaseTypeSchema = z.enum([
  "birth",
  "undeath",
  "revival",
  "rebirth",
]);
```

Build a shared base object with optional trimmed `from`, `to`, and `species`; extend it into a Zod
discriminated union. Require `species` on undeath. Permit optional `method` only on revival/rebirth.
Export inferred `CharacterMortality`, `CharacterMortalityPhase`, and per-phase types.

Use `superRefine` only for contradictions established by available evidence. Parse comparable dates
through `BastionDate`; do not invent missing boundaries. Cross-status checks must follow the
approved sparse-history rules.

### Step 4: Verify schema GREEN

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/types test
volta run --node 24 pnpm -F @bastion-falls/types typecheck
volta run --node 24 pnpm -F @bastion-falls/types build
```

Expected: all schema tests pass and the built wildcard export
`@bastion-falls/types/CharacterMortality` imports successfully.

### Step 5: Commit the standalone schema boundary

```bash
git add packages/types/package.json packages/types/src/CharacterMortality.ts \
  packages/types/test/CharacterMortality.test.ts pnpm-lock.yaml
git commit -m "feat(types): model character mortality phases"
```

This commit is safe before content migration because `CharacterDetailsSchema` still uses the old
flat fields until Task 4.

---

## Task 2: Implement Shared Phase Resolution and Age Arithmetic

**Objective:** Resolve normalized mortality phases, cumulative existence Age, approximation,
authored override precedence, and reusable birth/current-death anchors once for Astro and CLI.

**Files:**

- Create: `packages/types/src/CharacterAge.ts`
- Create: `packages/types/test/CharacterAge.test.ts`

### Step 1: Write resolver RED tests

Cover these contracts:

1. one open birth phase derives ordinary living age;
1. a closed birth phase derives age at death;
1. a dead gap between birth and undeath contributes zero;
1. same-date death and undeath contributes no dead time;
1. revival and rebirth phases add to cumulative existence;
1. several exact partial-year phases may combine into another completed year;
1. year/month precision yields deterministic approximate results;
1. any approximate contributing phase marks the total approximate;
1. missing contributing bounds makes full derivation unavailable;
1. malformed dates and backward phases return structured invalid evidence;
1. exact zero ages and zero-duration phases survive;
1. authored `age: 0` or another authored age always wins display source;
1. phase-derived age remains available for matching/conflicting override evidence;
1. `CalendarDate` inputs work without reparse and reject a distinct calendar identity;
1. original birth and current-death anchor helpers handle living, dead, undead, and revived records.

Use the real Bastion current date fixture and calendar arithmetic; do not mock date math.

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/types test
```

Expected: FAIL because `CharacterAge.ts` does not exist.

### Step 2: Implement normalized input and precision helpers

The module should export a programmatic input type:

```ts
export type MortalityDateInput = string | CalendarDate;
```

Normalize strings through `BastionDate.from`. Validate supplied objects with
`date.isBoundTo(bastionCalendar)`. Serialize only with `CalendarDate.toString()`.

For exact day precision, accumulate `epochDay` differences. For partial dates, downgrade both phase
bounds to their coarsest shared precision, estimate from known Bastion calendar fields, and mark the
phase approximate. Use `bastionCalendar.daysPerYear`, month offsets, and configured month lengths;
never assume Gregorian units.

### Step 3: Implement the public resolver

Use a narrow public shape such as:

```ts
export interface ResolvedMortalityPhase {
  readonly type: CharacterMortalityPhase["type"];
  readonly from?: CalendarDate;
  readonly to?: CalendarDate;
  readonly species?: string;
  readonly method?: string;
  readonly durationDays?: number;
  readonly approximate: boolean;
  readonly open: boolean;
  readonly error?: string;
}

export interface ResolvedCharacterAge {
  readonly value?: number;
  readonly approximate: boolean;
  readonly source?: "phases" | "authored";
  readonly authoredAge?: number;
  readonly derivedAge?: number;
  readonly phases: readonly ResolvedMortalityPhase[];
  readonly error?: string;
}
```

A resolver call accepts `{ age?, mortality? }` plus current `CalendarDate`. Resolve phase evidence even
when an authored override wins `value`. Convert accumulated existence days to completed Bastion
years only after summing all measurable phases.

Also export anchor helpers for non-age consumers:

```ts
getOriginalBirthDate(mortality): string | undefined
getCurrentDeathDate(mortality): string | undefined
```

`getCurrentDeathDate` returns a death boundary only for currently dead/undead characters; it does
not mark a revived living character dead merely because their history contains a death.

### Step 4: Verify resolver GREEN

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/types test
volta run --node 24 pnpm -F @bastion-falls/types typecheck
volta run --node 24 pnpm -F @bastion-falls/types build
```

Expected: schema and resolver suites pass.

### Step 5: Commit the shared engine

```bash
git add packages/types/src/CharacterAge.ts packages/types/test/CharacterAge.test.ts
git commit -m "feat(types): derive cumulative character age"
```

---

## Task 3: Prepare and Prove the Low-Churn Content Transformer

**Objective:** Build a temporary, fixture-tested transform that changes only direct mortality/date
fields and preserves all unrelated MDX/YAML bytes.

**Files:**

- Create temporarily: `cli/scripts/migrate-character-mortality.ts`
- Create temporarily: `cli/scripts/migrate-character-mortality.test.ts`

These files are implementation scaffolding and are removed before Task 4's commit.

### Step 1: Write transform RED fixtures

Use complete MDX strings, not abstract objects. Cover:

- field ordering variations around `age`, aliases, dates, and mortality;
- single/double-quoted empty strings;
- missing dates and missing mortality;
- partial PF/AI dates;
- comments and unrelated nested YAML preserved byte-for-byte;
- a living record with empty death placeholder;
- a dead record with complete dates;
- an undead special-case mapping;
- idempotence on already migrated content;
- refusal on duplicate direct keys, multiline date values, malformed frontmatter, or unexpected
  indentation rather than guessing.

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/cli exec -- \
  node --import tsx --test scripts/migrate-character-mortality.test.ts
```

Expected: FAIL because the transformer does not exist.

### Step 2: Implement a line-preserving transform

Parse frontmatter semantically with existing YAML tooling to obtain values, but locate and replace
only four-space direct children of `character.details` in the original text. Remove scalar
`mortality`, `dateOfBirth`, and `dateOfDeath`; insert the nested mortality block at the first
removed field. Preserve `age` in place as an override.

Do not use `yaml.dump()` for the complete frontmatter because it would create unrelated churn across
hundreds of files.

Support `--check`, `--write`, and optional fixture/root arguments. `--check` must report candidate,
changed, refused, and unchanged counts without writing. A second `--write` run must produce zero
changes.

### Step 3: Encode the bounded migration policy

Pre-migration inventory at baseline:

```text
character files: 540
scalar mortality: alive 406, dead 118, unknown 7, undead 4
missing mortality: 5
age overrides: 76
dateOfBirth keys: 279
dateOfDeath keys: 231
```

Policy:

- existing `alive`, `dead`, and `unknown` become the same `status`;
- empty date strings are omitted rather than becoming phase bounds;
- ordinary alive/unknown with DOB gets one open birth phase;
- ordinary dead with DOB/DOD gets one closed birth phase;
- dead records with a known birth but unknown death retain `status: dead` and an incomplete birth
  phase with `from` but no invented `to`; dead records with no usable dates get `phases: []`;
- scalar records without usable dates get `phases: []`;
- the four status-less/undated stubs remain without a mortality object;
- Charlotte Highbury becomes `status: dead` with a birth phase beginning `1247-03-15 AI` and unknown
  `to`; remove literal `dateOfDeath: undefined`, supported by current Highbury canon;
- Aina Bentayga, Kala, and Talsin McFarland become `dead`; their real death dates supersede stale
  `alive` scalars;
- Narmaya, Oscar, Lord Boyle, and Jarvid use the exact adjudicated mappings in the design;
- legacy current undead records never infer subtype/date from `details.species` unless the
  adjudicated mapping explicitly does so.

### Step 4: Prove the transformer on a copied tree

Copy only character MDX files to a temporary directory, run `--write`, then verify:

```bash
volta run --node 24 pnpm -F @bastion-falls/cli exec -- \
  node --import tsx scripts/migrate-character-mortality.ts --check <temp-root>
```

Expected after the first write:

- second pass changes zero files;
- no refused files;
- no scalar mortality or flat date keys under character details;
- all age values and all non-target lines remain identical;
- semantic phase/status counts match the migration policy.

Do not commit yet. Task 4 performs the atomic schema/consumer/content cutover.

---

## Task 4: Cut Over Schema, Audit, Producers, Consumers, and Content Atomically

**Objective:** Switch the repository to the object schema in one verified boundary so no committed
state accepts only half the contract.

**Files:**

- Modify: `packages/types/src/Character.ts`
- Modify: `packages/types/src/index.ts` if root exports are chosen
- Modify: `cli/src/commands/calendar/audit.ts`
- Modify: `cli/src/commands/calendar/audit.test.ts`
- Modify: `astro/src/lib/timeline.ts`
- Modify: `cli/src/commands/kingraph/impl.ts`
- Modify: `cli/src/commands/migrate/functions/character.ts`
- Modify: `cli/src/commands/new/character/command.ts`
- Modify: `cli/src/commands/new/character/impl.ts`
- Modify: `cli/templates/character.ejs`
- Modify: `astro/src/components/sidebar-info/CharacterSidebarInfo.astro`
- Delete: `astro/src/lib/character-age.ts`
- Delete/migrate: `astro/src/lib/character-age.test.ts`
- Modify: character MDX files selected by the transformer
- Remove: temporary Task 3 migration script/test before commit

### Step 1: Wire `CharacterDetailsSchema`

Replace flat fields with:

```ts
mortality: CharacterMortalitySchema.optional(),
```

Remove `dateOfBirth` and `dateOfDeath`. Keep `age` and ordinary `species` unchanged.

Run package tests/typecheck. Expected: package GREEN; repository consumers/content may still fail
until this task completes.

### Step 2: Make `bfcli calendar audit-ages` phase-aware

Import the shared resolver instead of duplicating arithmetic. Preserve override categories:

- `derived-only`;
- `matching-override`;
- `conflicting-override`;
- `invalid`;
- `missing-date` (meaning incomplete phase bounds/history).

Approximation is orthogonal JSON evidence (`approximate: true`), not a failure category. A partial
but usable phase-derived age remains derived/matching/conflicting. Keep `insufficient-precision`
only if a record's precision cannot support the approved deterministic estimate; remove it if no
valid state can produce that category.

Audit records should include status, normalized phase evidence, authored/derived totals,
approximation, and reason without serializing class instances.

Rewrite fixture MDX in `audit.test.ts` to the new shape and preserve full command/discovery tests.

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/cli test -- \
  src/commands/calendar/audit.test.ts
```

Expected: audit tests pass.

### Step 3: Update timeline and Kingraph anchors

In `astro/src/lib/timeline.ts`, replace flat character date reads with shared original-birth and
current-death helpers. Preserve explicit authored `timeline` arrays, which remain authoritative for
multiple or specially labelled events. Preserve the current default behavior of emitting one
implicit character entry, preferring original birth and falling back to current death; do not
automatically publish every mortality phase as a world-timeline event in this feature.

In `cli/src/commands/kingraph/impl.ts`:

- `born` comes from original birth phase `from`;
- `died` is emitted only for current `dead`/`undead` status using the current-death helper;
- revived living history does not make a current living person appear dead in family graphs.

Use focused shared-helper tests as the durable guard. Verify the real timeline and Kingraph commands
through bounded smoke runs rather than adding broad snapshot suites to previously untested modules.

### Step 4: Update character producers

Legacy migration:

- translate legacy status/dates into phases;
- for legacy undead without subtype evidence, use `species: unknown` and omit undeath `from` rather
  than inventing simultaneity;
- retain legacy age as override.

`bfcli new character`:

- keep existing date flags for CLI compatibility;
- map DOB/DOD flags into a birth phase and `alive`/`dead` status;
- do not add speculative flags for undeath/revival/rebirth in this task;
- update `character.ejs` to render nested mortality without `undefined` placeholder fields.

Perform one real temp-directory scaffold smoke check and parse its frontmatter through
`CharacterSchema`.

### Step 5: Cut over the sidebar to the shared resolver

Before committing the schema change, make `CharacterSidebarInfo.astro` build against the new shape:

- call the shared resolver with `BastionNow.date()`;
- guard optional `character.details` rather than dereferencing it unconditionally;
- switch the mortality icon on `details.mortality?.status`;
- render the resolved/overridden Age as plain text for this boundary;
- remove separate flat birth/death rows;
- delete the obsolete Astro-local age adapter after its durable behavior tests have moved to
  `packages/types/test/CharacterAge.test.ts`.

The expandable disclosure is deliberately deferred to Task 5, but this minimal cutover keeps the
repository buildable at the Task 4 commit.

### Step 6: Run the migration on authored content

Run the proven Task 3 transformer with `--write`, then run it again in `--check` mode.

Required semantic checks:

```text
flat character.details.dateOfBirth: 0
flat character.details.dateOfDeath: 0
scalar character.details.mortality: 0
refused transforms: 0
second-pass changes: 0
age override values preserved: 76 before any separately adjudicated removal
```

Read all exceptional diffs individually. Aggregate/dedupe/count with code, not visual estimation.

### Step 7: Remove temporary migration scaffolding

Delete `cli/scripts/migrate-character-mortality.ts` and its test after the migration and idempotence
receipts are saved under `/tmp` or the Hermes workspace. Do not leave a permanent one-use command.

### Step 8: Verify the atomic cutover

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/types test
volta run --node 24 pnpm -F @bastion-falls/types typecheck
volta run --node 24 pnpm -F @bastion-falls/types build
volta run --node 24 pnpm -F @bastion-falls/cli test
volta run --node 24 pnpm -F @bastion-falls/cli typecheck
volta run --node 24 pnpm -F @bastion-falls/cli build
volta run --node 24 pnpm -F @bastion-falls/astro test
volta run --node 24 pnpm -F @bastion-falls/astro exec astro sync
BASTION_CALENDAR_OFFLINE=true volta run --node 24 pnpm -F @bastion-falls/astro exec astro check
BASTION_CALENDAR_OFFLINE=true volta run --node 24 pnpm -F @bastion-falls/astro build
volta run --node 24 pnpm bfcli calendar audit-ages --json > /tmp/mortality-audit.json
volta run --node 24 pnpm exec rumdl check \
  $(git diff --name-only -- 'astro/src/content/docs/world/characters/*.mdx')
git diff --check
```

Expected:

- all package/CLI checks pass;
- Astro content sync accepts all migrated records;
- audit contains no invalid lifecycle or unexplained override conflict;
- only target frontmatter lines changed in ordinary character files.

### Step 9: Commit the cutover

```bash
git add packages/types/src/Character.ts packages/types/src/index.ts \
  cli/src/commands/calendar/audit.ts cli/src/commands/calendar/audit.test.ts \
  astro/src/lib/timeline.ts cli/src/commands/kingraph/impl.ts \
  cli/src/commands/migrate/functions/character.ts \
  cli/src/commands/new/character/command.ts cli/src/commands/new/character/impl.ts \
  cli/templates/character.ejs astro/src/components/sidebar-info/CharacterSidebarInfo.astro \
  astro/src/lib/character-age.ts astro/src/lib/character-age.test.ts \
  astro/src/content/docs/world/characters pnpm-lock.yaml
git commit -m "refactor(characters): migrate mortality into phases"
```

Do not stage temporary migration scripts or generated/ignored timeline output.

---

## Task 5: Add the Expandable Age Disclosure

**Objective:** Replace the flat sidebar Age/date rows with the approved semantic disclosure while
keeping ordinary character cards compact.

**Files:**

- Create: `astro/src/components/sidebar-info/CharacterAgeDetail.astro`
- Create: `astro/src/components/sidebar-info/characterAgeDetail.ts`
- Create: `astro/src/components/sidebar-info/characterAgeDetail.test.ts`
- Modify: `astro/src/components/sidebar-info/CharacterSidebarInfo.astro`

### Step 1: Write presentation RED tests

The pure presentation helper maps normalized phase data to UI text. Test:

- `birth` -> `Born`, closed `Lived for`, open `Alive for`;
- `undeath` -> `Became undead`, closed `Was undead for`, open `Undead for`;
- `revival` -> `Revived`, closed `Lived again for`, open `Alive again for`;
- `rebirth` -> `Reborn`, closed `Lived this life for`, open `Living this life for`;
- species rendered separately with no automatic article;
- method rendered as `Via {method}`;
- approximate values carry `~`;
- authored override notes differ for conflicting, matching, and incomplete derivation;
- no override badge/asterisk text is emitted for the collapsed row.

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/astro test -- \
  src/components/sidebar-info/characterAgeDetail.test.ts
```

Expected: FAIL because the helper does not exist.

### Step 2: Implement the pure presentation helper

Keep all phrase mappings centralized in `characterAgeDetail.ts`. Do not generate `a`/`an` or
species-specific sentences. Accept normalized shared resolver output and return display-ready
strings; do not parse dates in presentation code.

### Step 3: Implement `CharacterAgeDetail.astro`

Use native semantic `<details>/<summary>` when meaningful phase history exists. The collapsed row
contains only the Age value. The expanded panel appears directly beneath it and includes:

- optional authored-override explanation inside the panel only;
- ordered phase event/date;
- separately rendered species/method;
- exact or approximate duration.

Age with no meaningful phase history remains plain text. Make the summary keyboard accessible and
preserve focus visibility; do not use a hover-only popover or client JavaScript for basic
disclosure.

### Step 4: Integrate the shared resolver

In `CharacterSidebarInfo.astro`:

- reuse the shared resolver result already introduced in Task 4;
- replace the temporary plain Age row with `CharacterAgeDetail`;
- keep other species, sex, relationship, and stat rendering unchanged.

### Step 5: Verify UI GREEN

Run:

```bash
volta run --node 24 pnpm -F @bastion-falls/astro test
BASTION_CALENDAR_OFFLINE=true volta run --node 24 pnpm -F @bastion-falls/astro exec astro check
BASTION_CALENDAR_OFFLINE=true volta run --node 24 pnpm -F @bastion-falls/astro build
```

Inspect built HTML for:

- Narmaya: approximate Age and birth/vampire history;
- Oscar: exact dates and current revenant phase;
- Lord Boyle: dead gap visible through phase dates without adding it to Age;
- Jarvid: authored/omitted Age behavior plus revenant/revival history;
- Fawn and Minfilia: plain authored override when phase history cannot derive a total;
- Uther: compact phase-derived Age;
- one ordinary no-history character: no empty disclosure.

Confirm 1,296 expected site pages still build unless the content count legitimately changes for an
independent reason.

### Step 6: Commit the sidebar feature

```bash
git add astro/src/components/sidebar-info/CharacterAgeDetail.astro \
 astro/src/components/sidebar-info/characterAgeDetail.ts \
 astro/src/components/sidebar-info/characterAgeDetail.test.ts \
 astro/src/components/sidebar-info/CharacterSidebarInfo.astro
git commit -m "feat(characters): disclose mortality age phases"
```

---

## Task 6: Final Audit, Review, and Completion

**Objective:** Prove the complete repository contract, review the mass migration, and leave a clean
branch with honest residual audit state.

**Files:**

- Modify only files required by findings from verification/review.

### Step 1: Run the full verification bundle

```bash
volta run --node 24 pnpm -F @bastion-falls/calendar test
volta run --node 24 pnpm -F @bastion-falls/types test
volta run --node 24 pnpm -F @bastion-falls/types typecheck
volta run --node 24 pnpm -F @bastion-falls/types build
volta run --node 24 pnpm -F @bastion-falls/cli test
volta run --node 24 pnpm -F @bastion-falls/cli typecheck
volta run --node 24 pnpm -F @bastion-falls/cli build
volta run --node 24 pnpm -F @bastion-falls/astro test
BASTION_CALENDAR_OFFLINE=true volta run --node 24 pnpm -F @bastion-falls/astro exec astro check
BASTION_CALENDAR_OFFLINE=true volta run --node 24 pnpm -F @bastion-falls/astro build
volta run --node 24 pnpm bfcli calendar audit-ages --json > /tmp/mortality-audit-final.json
git diff --check
```

Run Biome on exact touched TypeScript/Astro files and rumdl on exact touched MDX/Markdown files
rather than formatting unrelated repository content.

### Step 2: Verify content invariants programmatically

Aggregate all 540 character files and assert:

- no flat date keys under `character.details`;
- no scalar mortality values;
- all mortality objects parse through `CharacterSchema`;
- every current undead record has an undeath species;
- all 76 pre-migration authored ages are either preserved or explicitly accounted for;
- no unexpected prose/body changes occurred;
- migration exceptions match the approved list;
- no generated or temporary migration artifacts are staged.

Read back Narmaya, Oscar, Lord Boyle, Jarvid, Charlotte, Aina, Kala, Talsin, Fawn, Minfilia, and
Uther individually.

### Step 3: Run two-stage review

Dispatch read-only review lanes:

1. spec/canon compliance against the approved design and migration exceptions;
1. code quality, arithmetic, accessibility, and mass-diff scope safety.

Repair important findings, rerun affected focused checks, then rerun final aggregate invariants.

### Step 4: Commit verified review fixes if any

```bash
git add <exact-reviewed-files>
git commit -m "fix(characters): harden mortality phase migration"
```

Skip an empty commit when review finds nothing.

### Step 5: Report final state

Report:

- commit boundaries;
- exact audit category counts and approximation counts;
- schema/resolver/CLI/Astro test totals;
- offline page count and representative rendered receipts;
- any intentionally authored conflicting override;
- remaining incomplete mortality histories;
- branch/worktree status;
- push status as not pushed unless Nico separately authorizes it.

---

## Execution Notes

- Execute with fresh subagents per stable task where practical, but keep the Task 3/4 transformer
  and atomic cutover under one implementation owner so temporary migration assumptions do not drift.
- Require spec-compliance review before code-quality review at each committed boundary.
- Do not ask Nico to adjudicate empty-string placeholders. Escalate only genuine canon ambiguities
  not covered by the design or explicit migration exceptions.
- If an existing unrelated baseline check fails, reproduce it on `fa8f5859` before attributing it to
  this feature and report it separately.
