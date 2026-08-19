# Standalone Calendar And Live Campaign Date Implementation Plan

> **For Hermes:** Use the subagent-driven-development skill to implement this plan task by task,
> with spec-compliance review before code-quality review.

**Goal:** Build a standalone configurable calendar package, resolve the current Bastion Falls date
from Fantasy Calendar with a committed fallback, and derive safe character ages at build time.

**Architecture:** `@bastion-falls/calendar` owns pure calendar definitions, immutable dates,
durations, precision, epoch conversion, and serialized date-state validation.
`@bastion-falls/fantasy-calendar` owns provider wire schemas, retrieval, retry policy, conversion,
and provider-specific content-reference schemas. The CLI owns settings, atomic local-state
resolution, synchronization, and the read-only age audit. Astro reads only the resolved local state
through `BastionNow` and applies authored-age override rules in a small character-age adapter.

**Tech Stack:** TypeScript 6 ESM, Node 24, pnpm workspaces, Turbo, Node's built-in test runner,
Stricli, Zod 4 in the CLI, Astro 7, and the existing MDX/frontmatter helpers.

**Authoritative MVP contract:**
[2026-08-07-standalone-calendar-and-live-campaign-date-design.md](../specs/2026-08-07-standalone-calendar-and-live-campaign-date-design.md)

**Non-authorizing roadmap:** Leap predicates, intercalary days, clocks, moons, seasons, generalized
Fantasy Calendar import, and content cleanup remain deferred even if an implementation seam makes
them tempting.

---

## Global Constraints

- Work from the repository root unless a command says otherwise.
- Use TypeScript for all new code.
- Relative ESM imports use `.js` extensions in package and CLI source.
- The calendar package's source/runtime code must not import `node:fs`, `node:path`, `fetch`, Astro,
  environment variables, or Fantasy Calendar code. Package maintenance scripts may use Node
  filesystem APIs.
- Public months are one-based. Only the Fantasy Calendar adapter handles zero-based `timespan`.
- The Bastion epoch contract is `epochDay 0 === AI 0-01-01`; therefore
  `AI 1275-09-25 === epochDay 459264`.
- PF maps to negative internal years: `1 PF === internal year -1`; AI maps directly, including AI 0.
- Partial dates never receive invented fields or an epoch day.
- Normal tests never call the live Fantasy Calendar service.
- No character MDX files are modified by this implementation.
- Do not commit unless Nico explicitly authorizes commits. The commit messages below are suggested
  checkpoints, not automatic permission.
- Every task maps to the approved MVP. Stop when Task 15 passes.

## Planned File Map

### New package

- Create `packages/calendar/package.json`.
- Create `packages/calendar/tsconfig.json`.
- Create `packages/calendar/src/errors.ts`.
- Create `packages/calendar/src/definition.ts`.
- Create `packages/calendar/src/date.ts`.
- Create `packages/calendar/src/duration.ts`.
- Create `packages/calendar/src/state.ts`.
- Create `packages/calendar/src/bastion.ts`.
- Create `packages/calendar/src/index.ts`.
- Create focused tests under `packages/calendar/test/`.

### Fantasy Calendar adapter package

- Create `packages/fantasy-calendar/package.json`.
- Create `packages/fantasy-calendar/tsconfig.json`.
- Create `packages/fantasy-calendar/src/client.ts`.
- Create `packages/fantasy-calendar/src/errors.ts`.
- Create `packages/fantasy-calendar/src/wire-schemas.ts`.
- Create `packages/fantasy-calendar/src/content-schemas.ts`.
- Create `packages/fantasy-calendar/src/index.ts`.
- Create focused tests under `packages/fantasy-calendar/test/`.
- Move the Task 8 provider client and tests out of the CLI in Task 9.5.

### CLI

- Create `cli/src/commands/calendar/command.ts`.
- Create `cli/src/commands/calendar/settings.ts`.
- Create `cli/src/commands/calendar/fantasy-calendar.ts`.
- Create `cli/src/commands/calendar/state-files.ts`.
- Create `cli/src/commands/calendar/resolve.ts`.
- Create `cli/src/commands/calendar/sync.ts`.
- Create `cli/src/commands/calendar/audit.ts`.
- Create focused sibling `*.test.ts` files.
- Modify `cli/src/app.ts`.
- Modify `cli/package.json`.
- Modify root `package.json` only to repair the existing `pnpm bfcli` forwarding script.

### Astro

- Create `astro/src/data/bastion-calendar-state.json` through the explicit sync path.
- Create `astro/src/lib/bastion-now.ts` and its test.
- Create `astro/src/lib/character-age.ts` and its test.
- Modify `astro/src/components/sidebar-info/CharacterSidebarInfo.astro`.
- Modify `astro/package.json`.

### Workspace

- Modify `turbo.jsonc` for the new package build output.
- Update `pnpm-lock.yaml` through `pnpm install`.

---

## Task 1: Scaffold The Pure Calendar Package

**Objective:** Add a buildable and testable workspace package with no runtime dependencies.

**Files:**

- Create: `packages/calendar/package.json`
- Create: `packages/calendar/tsconfig.json`
- Create: `packages/calendar/src/index.ts`
- Modify: `turbo.jsonc`
- Modify: `cli/package.json`
- Modify: `astro/package.json`
- Modify: `pnpm-lock.yaml`

**Steps:**

- [ ] **Step 1: Create the package manifest**

Use the existing built-package convention from `packages/types/package.json`:

```json
{
  "name": "@bastion-falls/calendar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "clean": "node -e \"require('node:fs').rmSync('dist', { recursive: true, force: true })\"",
    "build": "pnpm run clean && tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test test/**/*.test.ts"
  },
  "devDependencies": {
    "tsx": "^4.23.1",
    "typescript": "6.0.3"
  },
  "volta": {
    "extends": "../../package.json"
  }
}
```

- [ ] **Step 2: Create strict build configuration**

Create `packages/calendar/tsconfig.json` with NodeNext ESM, `src` as `rootDir`, `dist` as `outDir`,
declarations enabled, and the same strict indexed-access flags used by
`packages/types/tsconfig.json`. Exclude `test/` and `dist/` from emission.

- [ ] **Step 3: Add the empty public entry point**

Create `packages/calendar/src/index.ts` exporting nothing initially:

```ts
export {};
```

- [ ] **Step 4: Wire workspace dependencies and Turbo output**

Add `@bastion-falls/calendar: "workspace:^"` to both `cli/package.json` and
`astro/package.json`. Add an explicit `@bastion-falls/calendar#build` entry to `turbo.jsonc` with
`dependsOn: ["^build"]` and `outputs: ["dist/**"]`.

- [ ] **Step 5: Refresh workspace links**

Run: `pnpm install`

Expected: exit 0; `pnpm-lock.yaml` records the two workspace links without downloading a runtime
calendar dependency.

- [ ] **Step 6: Verify the scaffold**

Run:

```bash
pnpm -F @bastion-falls/calendar typecheck
pnpm -F @bastion-falls/calendar build
```

Expected: both exit 0 and `packages/calendar/dist/index.js` plus `index.d.ts` exist.

**Suggested commit:** `feat(calendar): scaffold standalone calendar package`

---

## Task 2: Validate Calendar Definitions

**Objective:** Establish the immutable, data-driven calendar contract before writing date
arithmetic.

**Files:**

- Create: `packages/calendar/src/errors.ts`
- Create: `packages/calendar/src/definition.ts`
- Create: `packages/calendar/test/definition.test.ts`
- Modify: `packages/calendar/src/index.ts`

**Required interface:**

```ts
export type CalendarOverflow = "constrain" | "reject";

export interface CalendarMonthDefinition {
  readonly id: string;
  readonly name: string;
  readonly days: number;
}

export interface CalendarEraDefinition {
  readonly id: string;
  readonly name: string;
  readonly direction: 1 | -1;
  readonly yearOffset: number;
  readonly minimumYear: number;
}

export interface CalendarDefinition {
  readonly id: string;
  readonly months: readonly CalendarMonthDefinition[];
  readonly week: {
    readonly weekdays: readonly string[];
    readonly epochWeekday: number;
  };
  readonly eras: readonly CalendarEraDefinition[];
  readonly format: {
    readonly eraPosition: "prefix" | "suffix";
    readonly dateSeparator: string;
    readonly padMonth: number;
    readonly padDay: number;
  };
  readonly epoch: {
    readonly epochDay: number;
    readonly year: number;
    readonly month: number;
    readonly day: number;
  };
  readonly overflow: CalendarOverflow;
}
```

- [ ] **Step 1: Write failing definition tests**

Cover one valid calendar plus distinct failures for duplicate IDs, empty months/weekdays/eras,
nonpositive month lengths, an out-of-range epoch weekday, invalid format settings, invalid epoch
fields, duplicate era IDs, and invalid minimum years. Assert a typed `CalendarDefinitionError`, not
generic string matching alone.

- [ ] **Step 2: Verify RED**

Run: `pnpm -F @bastion-falls/calendar test`

Expected: FAIL because `defineCalendar` and `CalendarDefinitionError` do not exist.

- [ ] **Step 3: Implement minimal immutable definition construction**

Implement `defineCalendar` and a `CalendarSystem` that defensively copies and freezes the validated
definition. Precompute only values required by the MVP: month offsets, days per year, and lookup
maps. Do not add leap-rule callbacks or arbitrary nested interval machinery.

- [ ] **Step 4: Export the definition API and verify GREEN**

Run:

```bash
pnpm -F @bastion-falls/calendar test
pnpm -F @bastion-falls/calendar typecheck
```

Expected: all definition tests pass and typecheck exits 0.

**Suggested commit:** `feat(calendar): define validated repeating calendars`

---

## Task 3: Implement Complete Date And Epoch Conversion

**Objective:** Round-trip full calendar dates through the shared integer epoch-day axis, including
negative years.

**Files:**

- Create: `packages/calendar/src/date.ts`
- Create: `packages/calendar/src/bastion.ts`
- Create: `packages/calendar/test/epoch.test.ts`
- Modify: `packages/calendar/src/definition.ts`
- Modify: `packages/calendar/src/index.ts`

**Required complete-date contract:**

```ts
export interface CompleteDateFields {
  readonly era: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

calendar.dateFrom(fields)
calendar.dateFromEpochDay(epochDay)
date.epochDay
date.calendarId
date.weekdayIndex
date.weekdayName
```

- [ ] **Step 1: Write failing epoch tests**

Use a small variable-month test calendar and assert:

- epoch anchor round trip;
- first and last day of each month;
- previous and next year boundaries;
- negative internal year round trips;
- invalid day/month rejection;
- weekday calculation from the configured epoch weekday;
- dates remain bound to their originating calendar.

Add the Bastion anchors using field construction:

```ts
assert.equal(
  BastionDate.from({ era: "AI", year: 0, month: 1, day: 1 }).epochDay,
  0,
);
assert.equal(
  BastionDate.from({ era: "AI", year: 1275, month: 9, day: 25 }).epochDay,
  459264,
);
assert.deepEqual(BastionDate.fromEpochDay(459264).fields, {
  era: "AI",
  year: 1275,
  month: 9,
  day: 25,
});
assert.equal(BastionDate.fromEpochDay(459264).weekdayName, "Sunday");
```

- [ ] **Step 2: Verify RED**

Run: `pnpm -F @bastion-falls/calendar test`

Expected: FAIL because date construction and epoch conversion are absent.

- [ ] **Step 3: Implement field validation and epoch conversion**

Convert era years to an internal signed year using:

```text
internalYear = yearOffset + direction * eraYear
```

For the repeating-year MVP, calculate days before an internal year with integer multiplication and
support negative years symmetrically. Convert epoch days back using floor division rather than
truncation so negative values round-trip correctly. Configure Bastion with the source calendar's
month names (`First` through `Twelfth`, retaining the authored `Eigth` and `Nineth` spellings),
Sunday-through-Saturday weekdays, and Saturday as the weekday of epoch day zero.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm -F @bastion-falls/calendar test
pnpm -F @bastion-falls/calendar typecheck
```

Expected: epoch tests pass, including the verified Bastion anchor.

**Suggested commit:** `feat(calendar): convert calendar dates through epoch days`

---

## Task 4: Add Precision-Aware Parsing And Formatting

**Objective:** Parse and format full and partial dates without inventing missing fields.

**Files:**

- Modify: `packages/calendar/src/date.ts`
- Create: `packages/calendar/test/parsing.test.ts`
- Modify: `packages/calendar/src/bastion.ts`
- Modify: `packages/calendar/src/index.ts`

**Required precision:**

```ts
export type DatePrecision = "year" | "month" | "day";
```

The Bastion definition accepts the repository's canonical suffix-era forms:

```text
1275 AI
1275-09 AI
1275-09-25 AI
```

Also accept the field object form. Generic parsing and formatting must honor the bound calendar's
configured era position, separator, and padding. Do not add natural-language parsing.

- [ ] **Step 1: Write failing parse/format tests**

Assert canonical formatting, case normalization, leading-zero normalization, custom prefix/suffix
era position, custom separator/padding, malformed string rejection, unknown era rejection, and that
year/month precision values throw `DatePrecisionError` when `.epochDay` is requested.

- [ ] **Step 2: Verify RED**

Run: `pnpm -F @bastion-falls/calendar test`

Expected: new parsing tests fail.

- [ ] **Step 3: Implement precision-preserving values**

A `CalendarDate` stores only fields present at its precision. `toString()` emits the same canonical
precision. `with()` may change provided fields but must not silently upgrade precision by filling
missing fields.

- [ ] **Step 4: Verify GREEN**

Run the package test and typecheck commands. Expected: all tests pass.

**Suggested commit:** `feat(calendar): parse dates without false precision`

---

## Task 5: Implement Durations And Calendar Arithmetic

**Objective:** Add the Temporal-style immutable arithmetic needed by age computation.

**Files:**

- Create: `packages/calendar/src/duration.ts`
- Modify: `packages/calendar/src/date.ts`
- Create: `packages/calendar/test/arithmetic.test.ts`
- Modify: `packages/calendar/src/index.ts`

**Required API:**

```ts
export interface CalendarDurationLike {
  readonly years?: number;
  readonly months?: number;
  readonly days?: number;
}

date.add(duration, { overflow?: "constrain" | "reject" })
date.subtract(duration, { overflow?: "constrain" | "reject" })
date.until(other)
date.since(other)
date.with(fields, { overflow?: "constrain" | "reject" })
```

- [ ] **Step 1: Write failing arithmetic tests**

Use variable month lengths to protect meaningful behavior: add/subtract days across month and year
boundaries, add months across years, constrain an invalid destination day, reject the same
operation, negative durations, immutability, and `until`/`since` sign symmetry.

- [ ] **Step 2: Verify RED**

Run package tests and confirm arithmetic cases fail for missing methods.

- [ ] **Step 3: Implement the smallest repeating-calendar arithmetic**

Day arithmetic may use epoch days. Month/year arithmetic must use calendar fields and apply the
selected overflow behavior. Reject arithmetic requiring unavailable partial-date fields.

- [ ] **Step 4: Verify GREEN**

Run package tests and typecheck. Expected: all arithmetic contracts pass.

**Suggested commit:** `feat(calendar): add calendar-aware date arithmetic`

---

## Task 6: Add Comparison, Cross-Calendar Rules, And Age

**Objective:** Complete the reusable date API and protect birthday-boundary semantics.

**Files:**

- Modify: `packages/calendar/src/date.ts`
- Create: `packages/calendar/test/comparison-and-age.test.ts`

**Required API:**

```ts
CalendarDate.compare(left, right)
date.equals(other)
date.ageOn(referenceDate): number
```

- [ ] **Step 1: Write failing comparison and age tests**

Cover:

- same-calendar comparison and equality;
- distinct calendars comparing through complete epoch days;
- partial cross-calendar comparison rejection;
- birthday one day before, on, and one day after the reference date;
- age across PF/AI;
- reference date before birth rejection;
- partial birth/reference precision rejection.

These cases define the RED boundary.

- [ ] **Step 2: Verify RED**

Run package tests and confirm the new cases fail.

- [ ] **Step 3: Implement comparison and completed-year age**

Calculate age as completed calendar years using a candidate anniversary in the reference year. Do
not implement age as bare year subtraction.

- [ ] **Step 4: Verify GREEN**

Run package tests and typecheck. Expected: all cases pass.

**Suggested commit:** `feat(calendar): calculate completed calendar ages`

---

## Task 7: Add Pure Serialized Calendar State

**Objective:** Give CLI and Astro one shared, I/O-free state contract.

**Files:**

- Create: `packages/calendar/src/state.ts`
- Create: `packages/calendar/test/state.test.ts`
- Modify: `packages/calendar/src/index.ts`

**Required state shape:**

```ts
export interface SerializedCalendarState {
  readonly schemaVersion: 1;
  readonly calendarId: string;
  readonly source: {
    readonly provider: string;
    readonly identifier: string;
    readonly endpoint: string;
  };
  readonly date: {
    readonly era: string;
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly epochDay: number;
  };
  readonly retrievedAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

- [ ] **Step 1: Write failing state tests**

Assert valid parse/serialize, schema-version rejection, calendar-ID mismatch, missing/empty source
provider, identifier, or endpoint, malformed timestamp, field/epoch disagreement, rejection of
unknown top-level/date fields, open diagnostic metadata, and immutable output.

- [ ] **Step 2: Verify RED**

Run package tests and confirm state APIs are missing.

- [ ] **Step 3: Implement strict pure parsing**

Expose:

```ts
parseCalendarState(calendar, input): SerializedCalendarState
serializeCalendarState(calendar, source, date, retrievedAt, metadata): SerializedCalendarState
```

Validate the serialized fields manually by constructing the date and comparing its computed epoch
day. Do not add Zod solely for this compact stable contract.

- [ ] **Step 4: Verify package boundaries and GREEN**

Run:

```bash
pnpm -F @bastion-falls/calendar test
pnpm -F @bastion-falls/calendar typecheck
pnpm -F @bastion-falls/calendar build
```

Then search `packages/calendar/src` for `node:fs|node:path|fetch\(|process\.env|astro` and expect no
matches.

**Suggested commit:** `feat(calendar): serialize validated local date state`

---

## Task 8: Resolve Retrieval Settings And Fetch Fantasy Calendar

**Objective:** Build a bounded, testable network adapter without touching files.

**Files:**

- Create: `cli/src/commands/calendar/settings.ts`
- Create: `cli/src/commands/calendar/settings.test.ts`
- Create: `cli/src/commands/calendar/fantasy-calendar.ts`
- Create: `cli/src/commands/calendar/fantasy-calendar.test.ts`

**Constants:**

```ts
export const BASTION_FANTASY_CALENDAR_HASH =
  "089e518f9ea966373b1c71535c25b98a";
export const DEFAULT_TIMEOUT_MS = 1_500;
export const DEFAULT_RETRIES = 1;
```

**Environment inputs:**

- `BASTION_CALENDAR_FETCH_TIMEOUT_MS`, valid range 100–10,000;
- `BASTION_CALENDAR_FETCH_RETRIES`, integer range 0–3;
- `BASTION_CALENDAR_OFFLINE`, strict boolean values `true|false|1|0`.

**Steps:**

- [ ] **Step 1: Write failing settings tests**

Assert defaults, valid environment overrides, supplied CLI override precedence, and specific
failures for NaN, fractions, negative, and out-of-range values.

- [ ] **Step 2: Write failing client tests with injected fetch and sleep**

Cover the exact `dynamic_data` URL, a valid response, zero-based `timespan` conversion, PF/AI
`current_era` mapping, unknown-era rejection, date/epoch disagreement, timeout/network retry, HTTP
429/5xx retry, ordinary 4xx no retry, malformed JSON/schema no retry, bounded attempt count, and
100–200 ms backoff values through an injected sleeper. No test may use wall-clock sleeps or the live
API.

- [ ] **Step 3: Verify RED**

Run:

```bash
pnpm -F @bastion-falls/calendar build
pnpm -F @bastion-falls/cli test
```

Expected: new tests fail because settings/client modules do not exist.

- [ ] **Step 4: Implement minimal settings and client**

Use Zod for the remote response envelope and `AbortSignal.timeout(timeoutMs)`. Return a
`BastionDate`; do not return the full remote object to callers. Retry only the approved categories.

- [ ] **Step 5: Verify GREEN**

Run CLI tests and typecheck. Expected: all pass without external network traffic.

**Suggested commit:** `feat(cli): fetch the Bastion campaign date safely`

---

## Task 9: Resolve And Atomically Write Local Calendar State

**Objective:** Select live or fallback state and write one valid untracked build artifact.

**Files:**

- Create: `cli/src/commands/calendar/state-files.ts`
- Create: `cli/src/commands/calendar/state-files.test.ts`
- Create: `cli/src/commands/calendar/resolve.ts`
- Create: `cli/src/commands/calendar/resolve.test.ts`

**Default repository-relative paths:**

```text
fallback: astro/src/data/bastion-calendar-state.json
resolved: astro/.astro/bastion-calendar-state.json
```

- [ ] **Step 1: Write failing atomic-write tests**

Use `mkdtemp` and injected failure points. Assert parent creation, temp-file-plus-rename behavior,
valid final JSON, no partial destination after failure, and cleanup of temporary files.

- [ ] **Step 2: Write failing resolver tests**

Cover live success, remote failure fallback, offline fallback without calling fetch, malformed
remote fallback, invalid fallback plus valid live success, and both sources invalid failing before
output. Assert that every ordinary resolution path leaves the tracked fallback bytes unchanged.
Assert concise structured warning data rather than matching console formatting in every test.

- [ ] **Step 3: Verify RED**

Run the focused files through:

```bash
pnpm -F @bastion-falls/calendar build
pnpm -F @bastion-falls/cli test
```

Expected: new tests fail.

- [ ] **Step 4: Implement repository discovery and atomic state files**

Discover the repository by walking up from `LocalContext.currentPath` for `pnpm-workspace.yaml`
using existing `find-up`. Keep path resolution in `state-files.ts`; keep source selection pure
enough to test with injected readers, writers, clock, and fetcher.

- [ ] **Step 5: Implement fallback warnings**

The command-facing result includes failure category, attempts, elapsed milliseconds, selected
fallback date, and fallback retrieval timestamp. Do not emit full stack traces on successful
fallback.

- [ ] **Step 6: Verify GREEN**

Run CLI tests and typecheck. Expected: all pass and tests leave no repository files behind.

**Suggested commit:** `feat(cli): resolve campaign date with atomic fallback`

---

## Task 9.5: Extract The Fantasy Calendar Adapter Package

**Objective:** Move provider-specific retrieval into a shared package before CLI routes and Astro
integration, while establishing minimal event-reference schemas without implementing event fetching.

**Authoritative extraction design:**
[2026-08-19-fantasy-calendar-adapter-extraction-design.md](../specs/2026-08-19-fantasy-calendar-adapter-extraction-design.md)

**Files:**

- Create: `packages/fantasy-calendar/package.json`
- Create: `packages/fantasy-calendar/tsconfig.json`
- Create: `packages/fantasy-calendar/src/client.ts`
- Create: `packages/fantasy-calendar/src/errors.ts`
- Create: `packages/fantasy-calendar/src/wire-schemas.ts`
- Create: `packages/fantasy-calendar/src/content-schemas.ts`
- Create: `packages/fantasy-calendar/src/index.ts`
- Create: `packages/fantasy-calendar/test/client.test.ts`
- Create: `packages/fantasy-calendar/test/content-schemas.test.ts`
- Delete: `cli/src/commands/calendar/fantasy-calendar.ts`
- Delete: `cli/src/commands/calendar/fantasy-calendar.test.ts`
- Modify: `cli/src/commands/calendar/settings.ts`
- Modify: `cli/src/commands/calendar/resolve.ts`
- Modify: `cli/src/commands/calendar/resolve.test.ts`
- Modify: `cli/package.json`
- Modify: `turbo.jsonc`
- Modify: `pnpm-lock.yaml`

**Package exports:**

```text
@bastion-falls/fantasy-calendar
@bastion-falls/fantasy-calendar/schemas
```

- [ ] **Step 1: Scaffold the adapter package**

Follow the built-package convention from `packages/calendar/package.json`. The package is private,
uses NodeNext ESM, emits declarations into `dist`, and exposes both root and `./schemas` entry
points:

```json
{
  "name": "@bastion-falls/fantasy-calendar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./schemas": {
      "types": "./dist/content-schemas.d.ts",
      "import": "./dist/content-schemas.js"
    }
  }
}
```

Add runtime dependencies on `@bastion-falls/calendar: "workspace:^"` and the workspace's pinned
Zod line. Add `tsx` and TypeScript development dependencies and the standard `clean`, `build`,
`typecheck`, and Node test scripts. The package TypeScript configuration uses `lib: ["ESNext",
"DOM"]` because the client owns Fetch and AbortSignal types.

Add `@bastion-falls/fantasy-calendar#build` to `turbo.jsonc` with `dependsOn: ["^build"]` and
`outputs: ["dist/**"]`. Add the package as a CLI workspace dependency and run `pnpm install` to
refresh links and lockfile importers without unrelated churn.

- [ ] **Step 2: Write RED content-schema tests**

Create `packages/fantasy-calendar/test/content-schemas.test.ts`. Assert:

- non-empty string IDs normalize to branded strings;
- safe integer IDs normalize to decimal strings;
- empty/whitespace strings, fractions, unsafe integers, and malformed runtime values fail;
- `{ eventId }` references parse strictly;
- unknown reference keys fail.

The intended public shapes are:

```ts
FantasyCalendarEventIdSchema;
FantasyCalendarEventReferenceSchema;
type FantasyCalendarEventId;
type FantasyCalendarEventReference;
```

Run the package test command and confirm meaningful RED because the `/schemas` implementation is
absent.

- [ ] **Step 3: Implement the minimal content schemas**

Use Zod to accept a non-empty trimmed string or safe integer and transform both into one canonical
string before branding. Implement a strict reference object containing only `eventId`. Export these
symbols from `src/content-schemas.ts`; do not add banner fields, event retrieval, moon schemas, or a
generalized provider abstraction.

Run focused schema tests and typecheck. Expected: GREEN.

- [ ] **Step 4: Move the provider client with behavior unchanged**

Move the current Task 8 implementation into package-owned modules:

- `FantasyCalendarError` and failure categories move to `src/errors.ts`;
- the narrow `dynamic_data` Zod object moves to `src/wire-schemas.ts`;
- endpoint constants, fetch/retry/backoff logic, and FC-to-calendar conversion move to
  `src/client.ts`;
- `src/index.ts` exports the existing public adapter API.

Move the existing client tests into `packages/fantasy-calendar/test/client.test.ts`. Preserve all
assertions for endpoint identity, GET/AbortSignal, PF/AI conversion, schema/date/epoch failures,
retry categories, attempt counts, jitter endpoints, real default sleeper structure, and injected
callback failures. Normal tests remain fully injected and never contact the live service.

The package may keep private provider defaults required by direct client calls. Environment parsing,
offline policy, and CLI override precedence remain in `cli/src/commands/calendar/settings.ts`.

Run package tests against the moved implementation. Expected: all migrated tests pass with no
behavioral weakening.

- [ ] **Step 5: Migrate CLI consumers and remove the local adapter**

Update `cli/src/commands/calendar/resolve.ts` and later calendar modules to import client constants,
types, and functions from `@bastion-falls/fantasy-calendar`. Keep CLI settings imports local. Delete
the old CLI provider client and test instead of leaving a permanent re-export shim.

Search `cli/src` for relative imports of `./fantasy-calendar.js` and expect no matches. Search the
repository for duplicate definitions of the public calendar hash, endpoint, and
`FantasyCalendarError`; each provider symbol must have one source of truth in the package.

- [ ] **Step 6: Verify built public exports**

Run:

```bash
pnpm -F @bastion-falls/calendar build
pnpm -F @bastion-falls/fantasy-calendar test
pnpm -F @bastion-falls/fantasy-calendar typecheck
pnpm -F @bastion-falls/fantasy-calendar build
node --input-type=module -e \
  'import("@bastion-falls/fantasy-calendar").then(m => console.log(typeof m.fetchFantasyCalendarDate))'
node --input-type=module -e \
  'import("@bastion-falls/fantasy-calendar/schemas").then(m => console.log(m.FantasyCalendarEventIdSchema.parse(42)))'
```

Expected: package tests/typecheck/build pass; root import reports `function`; schema import reports
the canonical string `42`.

- [ ] **Step 7: Verify the migrated CLI and scope**

Run:

```bash
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
pnpm exec biome check packages/fantasy-calendar cli/src/commands/calendar
git diff --check
```

Confirm no character/content files changed, no event-fetching or Astro frontmatter integration was
added, and only package/CLI/workspace/lockfile files named above remain.

**Suggested commit:** `refactor(calendar): extract Fantasy Calendar adapter package`

---

## Task 10: Add Resolve And Sync CLI Routes

**Objective:** Expose explicit operational commands and repair the root forwarding path used by repo
documentation.

**Files:**

- Create: `cli/src/commands/calendar/command.ts`
- Create: `cli/src/commands/calendar/sync.ts`
- Create: `cli/src/commands/calendar/sync.test.ts`
- Modify: `cli/src/app.ts`
- Modify: root `package.json`

**Command surface:**

```text
pnpm bfcli calendar resolve
pnpm bfcli calendar sync
```

Supported flags are `--timeout-ms`, `--retries`, `--offline` on resolve and `--timeout-ms`,
`--retries`, `--refresh-metadata` on sync. Sync must never accept offline mode.

- [ ] **Step 1: Write failing sync tests**

Assert changed remote state updates the tracked snapshot atomically, unchanged canonical state
leaves bytes unchanged, `--refresh-metadata` permits timestamp-only refresh, and all
retrieval/validation failures preserve the original bytes. On the first sync, a missing fallback
(`ENOENT` only) is a valid bootstrap state: fetch and validate the live date, preview labeled
`Current committed state` with `(missing)` followed by `Proposed remote state`, then create
`astro/src/data/bastion-calendar-state.json` through the same atomic writer. The sync result exposes
an absent `current` value for this case; malformed, unreadable, or other fallback-read errors fail
before fetch/write. Capture both labeled records before the atomic writer is invoked.

- [ ] **Step 2: Implement Stricli route map and handlers**

Use lazy command loaders matching `cli/src/commands/ddb/command.ts`. Add `calendar` to
`cli/src/app.ts`. Keep handlers thin; orchestration remains in the tested modules. Sync formats the
validated current and proposed states through one deterministic preview helper, prints both, and
only then invokes the atomic update.

- [ ] **Step 3: Repair root `bfcli` forwarding**

Change the root script from the currently failing package command to the existing source execution
script:

```json
"bfcli": "_REAL_CWD=$INIT_CWD pnpm -F @bastion-falls/cli run exec"
```

- [ ] **Step 4: Verify commands without network**

Run:

```bash
pnpm -F @bastion-falls/calendar build
pnpm bfcli calendar resolve --offline
pnpm bfcli calendar --help
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
```

The first command is expected to create the committed fallback when it is absent, after printing the
truthful missing-state preview. Subsequent commands compare against that committed state.
Help, tests, and typecheck must pass.

**Suggested commit:** `feat(cli): add calendar resolve and sync commands`

---

## Task 11: Create The Fallback And Wire Build Preparation

**Objective:** Make every Astro dev/build select a local state before rendering.

**Files:**

- Create: `astro/src/data/bastion-calendar-state.json`
- Modify: `astro/package.json`
- Modify: `turbo.jsonc`

**Steps:**

- [ ] **Step 1: Run the explicit live synchronization probe**

This is the one intentional external integration call:

```bash
pnpm bfcli calendar sync
```

Expected: HTTP success, validated date, and a proposed snapshot for the Bastion calendar. Verify the
written date and epoch agree. If the service is unavailable, stop this task; do not fabricate a
snapshot.

- [ ] **Step 2: Add build/dev preparation scripts**

Add:

```json
"calendar:resolve": "_REAL_CWD=$INIT_CWD pnpm -F @bastion-falls/cli run exec calendar resolve",
"calendar:prepare": "pnpm -F @bastion-falls/calendar build && pnpm run calendar:resolve",
"predev": "pnpm run calendar:prepare",
"prestart": "pnpm run calendar:prepare",
"prebuild": "pnpm run calendar:prepare"
```

The explicit calendar build prevents direct package-scoped Astro dev/build from racing an unbuilt
workspace dependency. Root Turbo builds may do redundant tiny-package work, but correctness takes
priority; measure before optimizing it away.

Add an explicit Turbo task so a cached Astro build can never bypass live date resolution:

```json
"@bastion-falls/astro#build": {
  "cache": false,
  "dependsOn": ["^build"],
  "outputs": [".astro/**", "dist/**"]
}
```

Disabling the site build cache is deliberate. The remote campaign date is an external input Turbo
cannot hash before deciding whether to run `prebuild`; caching this task would silently skip the
required fetch. Revisit this only if resolution becomes an explicit uncached Turbo dependency whose
validated output participates in the site build key.

- [ ] **Step 3: Verify connected and offline resolution**

Run:

```bash
pnpm -F @bastion-falls/astro run calendar:resolve
BASTION_CALENDAR_OFFLINE=true pnpm -F @bastion-falls/astro run calendar:resolve
```

Expected: both produce valid `astro/.astro/bastion-calendar-state.json`; offline mode names the
committed fallback in its status output.

- [ ] **Step 4: Verify the exact clean package-build lifecycle**

Remove only the ignored generated state, then run the real package build in deterministic offline
mode:

```bash
node -e "require('node:fs').rmSync('astro/.astro/bastion-calendar-state.json', { force: true })"
BASTION_CALENDAR_OFFLINE=true pnpm -F @bastion-falls/astro build
test -f astro/.astro/bastion-calendar-state.json
```

Expected: `prebuild` recreates the state before Astro renders, the package's `clean` script removes
only `dist`, and the final file exists.

Run `pnpm turbo run build --filter @bastion-falls/astro --dry=json` and confirm the Astro build task
reports `cache: false`.

- [ ] **Step 5: Verify ignore behavior**

Run `git status --short` and confirm the committed snapshot is visible while
`astro/.astro/bastion-calendar-state.json` is ignored.

**Suggested commit:** `build(astro): resolve campaign date before rendering`

---

## Task 12: Add Local-Only BastionNow

**Objective:** Load the resolved local state without any network capability.

**Files:**

- Create: `astro/src/lib/bastion-now.ts`
- Create: `astro/src/lib/bastion-now.test.ts`

**Required API:**

```ts
export function createBastionNow(loadState: () => unknown): {
  date(): CalendarDate;
};

export const BastionNow: {
  date(): CalendarDate;
};
```

- [ ] **Step 1: Write failing tests**

Assert valid in-memory state, missing state, malformed state, wrong calendar ID, unexpected source
provider/hash/endpoint, field/epoch mismatch, and memoization after one successful load.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm -F @bastion-falls/calendar build
pnpm -F @bastion-falls/astro test
```

Expected: new tests fail.

- [ ] **Step 3: Implement local loading**

The default loader resolves `../../.astro/bastion-calendar-state.json` from `import.meta.url`, reads
it using Node filesystem APIs, and passes the parsed object to the package's state validator. It
then enforces the expected Fantasy Calendar provider, public hash, and `dynamic_data` endpoint.
`createBastionNow` remains injectable and contains no filesystem dependency itself.

- [ ] **Step 4: Verify GREEN**

Run Astro tests and typecheck after building `@bastion-falls/calendar`. Expected: all pass.

**Suggested commit:** `feat(astro): expose the resolved Bastion date locally`

---

## Task 13: Derive Character Display Ages Safely

**Objective:** Use authored ages as overrides and derive only exact missing ages.

**Files:**

- Create: `astro/src/lib/character-age.ts`
- Create: `astro/src/lib/character-age.test.ts`
- Modify: `astro/src/components/sidebar-info/CharacterSidebarInfo.astro:14-32,143-162`

**Required pure adapter:**

```ts
export interface CharacterAgeDetails {
  readonly age?: number;
  readonly dateOfBirth?: string;
  readonly dateOfDeath?: string;
  readonly mortality?: "alive" | "dead" | "undead" | "unknown";
}

export function resolveCharacterAge(
  details: CharacterAgeDetails,
  currentDate: CalendarDate,
): number | undefined;
```

- [ ] **Step 1: Write failing age-selection tests**

Cover explicit override precedence, living derived age, dead age at death, undead/unknown using
current date unless explicitly overridden, missing birth date, partial date, malformed date, future
birth, death before birth, and an exact zero age.

- [ ] **Step 2: Verify RED**

Build `@bastion-falls/calendar`, run Astro tests, and confirm the new cases fail.

- [ ] **Step 3: Implement the pure adapter**

Use `BastionDate` and `ageOn`; do not duplicate birthday arithmetic. Return `undefined` for
insufficient precision, malformed dates, future births, and death-before-birth records. The audit in
Task 14 owns the diagnostic classification for those unavailable values.

- [ ] **Step 4: Integrate the sidebar**

Compute `displayAge` in frontmatter. Preserve zero with an explicit undefined check rather than a
truthiness test:

```astro
{displayAge !== undefined && (
  <SidebarDetail label="Age">{displayAge}</SidebarDetail>
)}
```

Call `BastionNow.date()` only when an authored override is absent and derivation is otherwise
possible, so a purely authored age does not unnecessarily depend on the clock.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm -F @bastion-falls/calendar build
BASTION_CALENDAR_OFFLINE=true pnpm -F @bastion-falls/astro test
BASTION_CALENDAR_OFFLINE=true pnpm -F @bastion-falls/astro typecheck
```

Expected: tests and typecheck pass.

**Suggested commit:** `feat(astro): derive character ages from campaign dates`

---

## Task 14: Add The Read-Only Age Audit

**Objective:** Report migration evidence without editing character content.

**Files:**

- Create: `cli/src/commands/calendar/audit.ts`
- Create: `cli/src/commands/calendar/audit.test.ts`
- Modify: `cli/src/commands/calendar/command.ts`

**Command:**

```text
pnpm bfcli calendar audit-ages [--json]
```

**Classifications:**

- `derived-only`;
- `matching-override`;
- `conflicting-override`;
- `insufficient-precision`;
- `invalid`;
- `missing-date`.

**Steps:**

- [ ] **Step 1: Write failing classifier tests**

Use compact in-memory character records for every classification, including dead-reference behavior.
The classifier returns structured records with file, authored age, derived age, dates, and reason
where applicable.

- [ ] **Step 2: Write a temporary-directory command test**

Create sample MDX files, parse them with the existing `cli/src/lib/frontmatter.ts` helper, and
assert stable JSON output and zero file modifications. Avoid snapshotting decorative console
spacing.

- [ ] **Step 3: Verify RED**

Build `@bastion-falls/calendar`, run CLI tests, and confirm audit cases fail.

- [ ] **Step 4: Implement read-only discovery and output**

Discover `astro/src/content/docs/world/characters/**/*.mdx` from the repository root. Use the
resolved local state through the package parser; do not fetch. `--json` emits machine-readable
output while the default output gives category counts followed by conflicts.

- [ ] **Step 5: Verify GREEN against the repository**

Run:

```bash
pnpm -F @bastion-falls/calendar build
BASTION_CALENDAR_OFFLINE=true pnpm bfcli calendar resolve
pnpm bfcli calendar audit-ages --json
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
git status --short
```

Expected: audit succeeds, reports categories, and changes no character MDX files.

**Suggested commit:** `feat(cli): audit authored and derived character ages`

---

## Task 15: Full Verification And Scope Audit

**Objective:** Prove the complete thin slice works and no north-star machinery leaked into the MVP.

**Files:**

- Modify only files required to fix failures attributable to Tasks 1–14.

**Steps:**

- [ ] **Step 1: Run focused package and CLI gates**

```bash
pnpm -F @bastion-falls/calendar test
pnpm -F @bastion-falls/calendar typecheck
pnpm -F @bastion-falls/calendar build
pnpm -F @bastion-falls/cli test
pnpm -F @bastion-falls/cli typecheck
pnpm -F @bastion-falls/cli build
```

Expected: every command exits 0.

- [ ] **Step 2: Run deterministic offline site gates**

```bash
BASTION_CALENDAR_OFFLINE=true pnpm -F @bastion-falls/astro test
BASTION_CALENDAR_OFFLINE=true pnpm -F @bastion-falls/astro typecheck
BASTION_CALENDAR_OFFLINE=true pnpm -F @bastion-falls/astro lint
BASTION_CALENDAR_OFFLINE=true pnpm -F @bastion-falls/astro build
```

Expected: all exit 0 and the build logs that the committed fallback was selected.

- [ ] **Step 3: Run root integration gates**

```bash
BASTION_CALENDAR_OFFLINE=true pnpm lint
BASTION_CALENDAR_OFFLINE=true pnpm build
pnpm fmt
git diff --check
```

The root `test` script is intentionally not used because it currently exits with “no test
specified.” Expected: the listed commands exit 0; formatting produces no unrelated changes.

- [ ] **Step 4: Run one connected resolver probe**

```bash
pnpm bfcli calendar resolve
```

Expected: either a validated live state within the configured retry budget or a concise successful
fallback warning. A fallback here is acceptable; fabricated live success is not.

- [ ] **Step 5: Inspect browser-visible output**

Build or run preview and inspect at least one character with a derived age, one authored override,
and one dead character. Confirm the sidebar renders expected values and no client-side network call
to Fantasy Calendar is introduced by age display.

- [ ] **Step 6: Perform the bidirectional scope audit**

Confirm every acceptance gate in the design maps to completed evidence above. Search the new
package and feature code for leap, intercalary, moon, season, weather, clock, event-import, and
content-write machinery; any such implementation is out of scope and must be removed unless
required only as a negative test or roadmap comment.

- [ ] **Step 7: Review the final diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Confirm no character MDX content changed, `.astro` state is not tracked, and only approved package,
CLI, Astro, workspace, spec, and plan files remain.

**Suggested final commit:** `feat: derive character ages from the live campaign calendar`

---

## Handoff

Implementation uses a fresh subagent for each separable task. Each task requires:

1. RED evidence for its owned behavior;
1. minimal GREEN implementation;
1. focused verification;
1. spec-compliance review;
1. code-quality and test-economy review;
1. explicit approval before any commit.

Do not begin leap/intercalary work or bulk age cleanup after the MVP becomes green. Those are
separate future decisions.
