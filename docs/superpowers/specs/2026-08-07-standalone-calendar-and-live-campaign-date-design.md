# Standalone Calendar And Live Campaign Date Design

## Goal

Create a standalone, configurable calendar package and use it to derive character ages from the
current Bastion Falls campaign date without making builds depend on Fantasy Calendar availability.

The smallest complete loop is:

> Define the regular Bastion Falls calendar with the standalone package, resolve the current
> campaign date from Fantasy Calendar with a committed fallback, and derive exact character ages
> from canonical birth and death dates.

## Decisions

- The calendar package is a pure date-arithmetic library. It performs no network or filesystem I/O.
- Bastion Falls is a calendar definition consumed by the generic library, not hard-coded arithmetic.
- Version one supports regular repeating year/month/day structures. Arbitrary leap and intercalary
  rules are deferred.
- Fantasy Calendar remains the preferred source for the current campaign date.
- The repository contains a committed last-known-good state so remote failure never prevents an
  otherwise valid build.
- Build resolution may contact Fantasy Calendar; date arithmetic and `BastionNow` never do.
- Ordinary builds never rewrite tracked source files.
- An explicit sync command updates the committed fallback.
- Authored character ages remain explicit overrides until reviewed and removed.

## Ownership And Package Boundary

The implementation belongs in this repository.

Create a workspace package published internally as `@bastion-falls/calendar`. Its runtime must not
import Astro, Node filesystem APIs, environment variables, or Fantasy Calendar code. The package
provides generic calendar primitives and a configured Bastion Falls calendar export.

The expected logical boundary is:

```text
packages/calendar/
  generic calendar definition, date, duration, parsing, and arithmetic
  configured Bastion Falls calendar and BastionDate factory

cli/
  Fantasy Calendar HTTP retrieval
  retry, timeout, validation, resolve, and sync commands

astro/
  committed last-known-good state
  generated resolved build state
  local-only BastionNow adapter
  character age display integration
```

The implementation plan must name the exact files while preserving these ownership boundaries.

## Standalone Calendar Domain

### Calendar definition

`defineCalendar(definition)` constructs an immutable calendar system. The version-one definition
contains:

- a stable calendar identifier;
- an absolute integer epoch-day anchor;
- an ordered repeating year composed of named months;
- each month's integer day length;
- a configurable week length and weekday names;
- named era mappings and display formats;
- parsing and formatting conventions;
- default overflow behavior.

The absolute epoch day is the arithmetic spine. Every fully specified date can convert between
calendar fields and an integer epoch day.

The Bastion Falls definition has:

- 12 named months;
- 30 days in every month;
- a seven-day week;
- the PF and AI era mappings;
- the established year-zero behavior;
- the Fantasy Calendar epoch anchor verified against the committed snapshot.

Calendar definitions must be validated when constructed. Invalid definitions fail immediately with a
specific configuration error.

### CalendarDate

A `CalendarDate` is an immutable date bound to one calendar definition. It supports:

- construction from calendar fields;
- construction from an epoch day;
- calendar-aware parsing and formatting;
- `compare` and `equals`;
- `with`;
- `add` and `subtract`;
- `until` and `since`;
- epoch-day access for complete dates;
- explicit precision for year-, month-, and day-precision values.

Public month values are one-based. Fantasy Calendar's zero-based `timespan` is translated only by
the external adapter.

Cross-calendar comparison is permitted only when both dates are complete and mapped to the shared
absolute epoch-day axis. Operations that need missing fields reject partial dates rather than
choosing implicit values.

### CalendarDuration

A `CalendarDuration` represents signed calendar-relative years, months, and days. Date arithmetic
uses the bound calendar's interval structure and an explicit overflow policy. Version one supports
`constrain` and `reject`; silent rollover is not allowed.

### BastionDate

The package exports the configured Bastion Falls calendar and a convenient `BastionDate` factory.
Its API is equivalent in spirit to:

```text
BastionDate.from("1275-09-25 AI")
BastionDate.from({ era: "AI", year: 1275, month: 9, day: 25 })
BastionDate.fromEpochDay(459264)
```

The resulting values remain ordinary calendar-bound `CalendarDate` instances. Bastion-specific
configuration does not fork or duplicate the generic arithmetic implementation.

### Date precision

Parsing preserves source precision:

- `1275 AI` has year precision;
- `1275-09 AI` has month precision;
- `1275-09-25 AI` has day precision.

A partial date has no invented epoch day. Exact age computation requires enough precision in both
the birth date and reference date. The library returns an explicit unavailable result or throws a
typed precision error according to the called API; it never treats missing month or day values as
`1`.

## Local Current-Date Model

The pure package does not provide an environmental clock. The Astro application exposes a local
`BastionNow` adapter, mirroring Temporal's separation between date values and `Temporal.Now`.

`BastionNow.date()`:

- reads only the locally resolved build state;
- validates the state and calendar identity;
- returns a `BastionDate`;
- never performs network I/O;
- throws a clear error when resolved local state does not exist or is invalid.

A constructor or factory accepting an in-memory snapshot is available for deterministic callers and
tests.

## Calendar State

### Committed fallback

Store a tracked last-known-good snapshot at:

```text
astro/src/data/bastion-calendar-state.json
```

It contains:

- schema version;
- calendar identity;
- source provider and public calendar hash;
- era, year, one-based month, day, and epoch day;
- retrieval timestamp;
- enough source metadata to diagnose stale or mismatched data without storing the full remote
  calendar.

The snapshot is authored operational state, not generated site content.

### Resolved build state

Before Astro renders, the CLI resolver writes the selected state to:

```text
astro/.astro/bastion-calendar-state.json
```

This file is untracked and represents the date selected for that build. It is not a durable cache
and is not treated as the source of truth.

Resolution proceeds as follows:

1. When offline mode is enabled, skip remote retrieval and select the committed fallback.
1. Otherwise request the anonymous Fantasy Calendar `dynamic_data` endpoint.
1. Apply the configured per-attempt timeout and retry policy.
1. Validate and convert the response, including zero-based `timespan` conversion.
1. On success, write the validated live state as the resolved build state.
1. On remote failure, warn and write the validated committed fallback as the resolved build state.
1. If neither source yields valid state, fail before Astro rendering starts.

The resolver writes atomically so interruption cannot leave a partially written local state.

### Explicit synchronization

An explicit CLI command fetches and validates the remote date, shows the proposed old and new
states, and updates the committed snapshot. It does not run as a side effect of an ordinary build.

The command must fail without changing the snapshot when retrieval or validation fails. A no-change
sync is idempotent apart from human-readable status output; it must not rewrite the file solely to
change a retrieval timestamp when the canonical remote state is unchanged unless the user explicitly
requests metadata refresh.

## Fantasy Calendar Retrieval

Use only the narrow anonymous endpoint:

```text
GET https://app.fantasy-calendar.com/api/v1/calendar/{hash}/dynamic_data
```

Do not use the full calendar endpoint. It returns unrelated configuration, event, and
user-associated structures and creates unnecessary privacy and compatibility exposure.

The observed live response time on 2026-08-07 was:

| Metric       |     Time |
| ------------ | -------: |
| Minimum      |   352 ms |
| Median       |   473 ms |
| p90          |   575 ms |
| Cold/maximum | 1,270 ms |

Default retrieval policy:

- timeout: 1,500 ms per attempt;
- retries: one additional attempt;
- backoff: 100–200 ms with jitter;
- retry network failures, timeouts, HTTP 429, and HTTP 5xx;
- do not retry schema failures or ordinary HTTP 4xx responses.

Environment configuration:

- `BASTION_CALENDAR_FETCH_TIMEOUT_MS`;
- `BASTION_CALENDAR_FETCH_RETRIES`;
- `BASTION_CALENDAR_OFFLINE`.

Timeout must be between 100 and 10,000 ms. Retries must be an integer between zero and three.
Defaults bound normal remote delay before fallback to 3.2 seconds.

A fallback warning includes the failure category, attempts, elapsed time, selected fallback date,
and fallback retrieval timestamp. It remains concise and does not print a full stack trace during a
successful degraded build.

## Character Age Resolution

Age display resolves in this order:

1. A valid explicit `character.details.age` is an authored override and is displayed unchanged.
1. Otherwise parse `dateOfBirth` with the Bastion calendar.
1. For a dead character with a complete `dateOfDeath`, use the death date as the reference date.
1. For a living character, use `BastionNow.date()`.
1. Calculate completed calendar years only when both dates have sufficient precision.
1. Otherwise omit the derived age.

A future birth date, death before birth, malformed date, or incompatible era produces validation
evidence rather than a negative or fabricated age.

The package owns calendar arithmetic. Character-specific reference-date selection remains in the
Astro application.

## Age Migration Audit

Add a read-only audit command that classifies characters as:

- `derived-only`;
- `matching-override`;
- `conflicting-override`;
- `insufficient-precision`;
- `invalid`;
- `missing-date`.

The initial repository probe found 61 characters whose explicit ages and full AI birth dates were
directly comparable at the current campaign date. Of those, 28 matched and 33 conflicted. Therefore,
the implementation must not bulk-delete or override authored ages.

After reviewing audit output:

- redundant matching overrides may be removed in a separately reviewed content change;
- conflicting values remain authored overrides until canon is settled;
- intentional supernatural, suspended, approximate, or publicly mistaken ages continue to use the
  explicit override.

The feature implementation itself does not perform this content migration.

## Errors And Degraded Behavior

- Invalid calendar definitions fail package initialization.
- Invalid date strings preserve no partial fabricated result.
- Missing resolved local state makes `BastionNow.date()` fail clearly and synchronously.
- Remote retrieval failure selects the committed fallback and warns.
- Invalid committed fallback plus unavailable or invalid remote state fails the build.
- Sync failure leaves the tracked snapshot byte-for-byte unchanged.
- A calendar identity or epoch mismatch fails rather than combining states from different calendars.

## Verification

### Fast package checks

Use focused Node tests for stable owned contracts:

- calendar-definition validation;
- date-to-epoch and epoch-to-date round trips;
- PF/AI transition and year-zero behavior;
- variable month lengths within the supported repeating year model;
- comparison and equality;
- add, subtract, until, and since;
- constrain and reject overflow;
- birthday-before, birthday-on, and birthday-after age boundaries;
- age at death;
- partial-date precision rejection;
- cross-calendar epoch comparison rules;
- proof that the pure package has no network or filesystem dependency.

### Resolver and CLI checks

Use an injected fetch implementation and temporary files rather than the live service:

- successful zero-based remote conversion;
- timeout and bounded retry behavior;
- retryable versus non-retryable failures;
- malformed remote response fallback;
- offline resolution;
- atomic resolved-state writes;
- missing or invalid fallback failure;
- idempotent sync;
- failed sync preserving the tracked snapshot.

Do not call the live Fantasy Calendar API from the normal test suite. The explicit sync command is
the manual integration probe.

### Site checks

- focused age-resolution tests;
- Astro typecheck and package-scoped tests;
- Astro build using a deterministic local state;
- one manual or scripted sync probe when external connectivity is intentionally being verified;
- `git diff --check`.

Tests should not duplicate calendar arithmetic assertions at the component layer. Components prove
reference-date and override selection; the package tests prove date arithmetic.

## North-Star Roadmap — Not The MVP Implementation Contract

Possible future package capabilities include:

- executable leap-day predicates;
- intercalary days outside ordinary months;
- interval groupings beyond the repeating year/month/day model;
- eras with more complex reset or reverse-numbering rules;
- nonstandard clocks and sub-day units;
- recurring cycles, moons, and seasons;
- import of broader Fantasy Calendar definitions;
- richer conversion between independently configured calendars.

These possibilities are intentionally non-authorizing. They require a separate design decision and
must not enter version one merely as speculative generality.

## Explicit Exclusions

Version one does not:

- replace Fantasy Calendar as an editor or event tracker;
- implement arbitrary leap or intercalary schemes;
- fetch from the network inside the calendar package or `BastionNow`;
- rewrite tracked state during ordinary builds;
- automatically resolve existing age conflicts;
- modify character content as part of the feature implementation;
- expose the full Fantasy Calendar response to site code;
- introduce astronomy, weather, event, or clock simulation.

## Acceptance Gates

The design is satisfied when:

1. The standalone package represents the Bastion Falls calendar entirely through configuration.
1. Bastion dates round-trip through the verified epoch and perform correct age arithmetic.
1. `BastionDate` operations work with no network and no local state files.
1. `BastionNow.date()` reads only validated local resolved state and fails when it is absent.
1. Connected builds select a validated live Fantasy Calendar date within the configured retry
   budget.
1. Disconnected builds select the committed fallback and emit a concise warning.
1. Invalid live and fallback states fail before rendering.
1. Explicit age overrides remain unchanged while eligible characters without overrides derive age.
1. The audit reports age conflicts without editing content.
1. Package tests, resolver tests, Astro tests, typecheck, build, and `git diff --check` pass.

## Stop Rule

Implementation stops when the regular configurable calendar package, local current-date resolution,
character age derivation, and read-only audit satisfy the acceptance gates. Leap rules,
intercalary systems, generalized Fantasy Calendar import, content cleanup, and other north-star
capabilities need fresh approval and a separate implementation contract.
