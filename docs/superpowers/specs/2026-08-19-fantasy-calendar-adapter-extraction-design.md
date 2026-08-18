# Fantasy Calendar Adapter Extraction Design

## Goal

Extract the implemented Fantasy Calendar date client from the CLI into a shared workspace package
before CLI route and Astro integration work begins. The package will also establish the minimal
provider-specific Zod schemas needed to link authored event articles to stable Fantasy Calendar
event identities later, without implementing event retrieval or reconciliation yet.

## Why Extract Now

The current MVP correctly separates pure calendar arithmetic from provider I/O, but the Fantasy
Calendar adapter presently lives under `cli/src/commands/calendar/`. Task 10 will expose CLI routes,
and later tasks will make Astro consume resolved calendar state. Extracting now prevents the CLI
module layout from becoming an accidental shared API and gives future Astro event frontmatter a
provider-owned schema boundary before event-banner work begins.

This is an inserted Task 9.5. Tasks 1–9 remain valid and complete. Task 10 and later tasks consume
the extracted package instead of the CLI-local client.

## Package Boundary

Create a private workspace package:

```text
packages/fantasy-calendar/
  package.json
  tsconfig.json
  src/
    client.ts
    errors.ts
    wire-schemas.ts
    content-schemas.ts
    index.ts
  test/
    client.test.ts
    content-schemas.test.ts
```

The package is published internally as:

```text
@bastion-falls/fantasy-calendar
@bastion-falls/fantasy-calendar/schemas
```

### `@bastion-falls/fantasy-calendar` owns

- the public Fantasy Calendar hash and narrow anonymous endpoint construction;
- the `dynamic_data` response schema;
- HTTP timeout, retry, jitter, and error classification;
- Fantasy Calendar era/month conversion into `CalendarDate`;
- structured provider error types and public adapter constants.

### `@bastion-falls/fantasy-calendar/schemas` owns

- `FantasyCalendarEventIdSchema` and its inferred branded type;
- `FantasyCalendarEventReferenceSchema` and its inferred type;
- future provider-specific event/moon wire schemas when those capabilities are separately approved.

### The CLI continues to own

- environment-variable and command-line setting resolution;
- offline policy;
- repository discovery and file paths;
- committed fallback and generated resolved-state orchestration;
- sync, audit, and human-readable command output.

### `@bastion-falls/calendar` remains pure

The core calendar package keeps no Zod, Fantasy Calendar, HTTP, environment, filesystem, CLI, or
Astro dependency. It continues to own provider-neutral definitions, dates, durations, arithmetic,
and serialized local calendar state.

### `@bastion-falls/types` remains world-focused

Fantasy Calendar IDs and remote wire contracts do not enter `@bastion-falls/types`. Event articles
retain their existing world-event metadata while adding a separate provider integration entity.

## Public API

The root package export preserves the currently implemented adapter surface:

```ts
export {
  BASTION_FANTASY_CALENDAR_ENDPOINT,
  BASTION_FANTASY_CALENDAR_HASH,
  FantasyCalendarError,
  fetchFantasyCalendarDate,
  type FantasyCalendarFailureCategory,
  type FantasyCalendarFetchOptions,
} from "@bastion-falls/fantasy-calendar";
```

CLI-only settings such as `DEFAULT_TIMEOUT_MS`, `DEFAULT_RETRIES`, and
`resolveCalendarSettings()` remain under the CLI. The package client accepts explicit bounded
options and provides its own stable defaults where needed by direct callers.

The schema subpath exports:

```ts
export {
  FantasyCalendarEventIdSchema,
  FantasyCalendarEventReferenceSchema,
  type FantasyCalendarEventId,
  type FantasyCalendarEventReference,
} from "@bastion-falls/fantasy-calendar/schemas";
```

## Event Identity Schema

Public documentation does not establish one permanent JSON primitive for every Fantasy Calendar
event ID. The boundary therefore accepts either:

- a non-empty string; or
- a safe integer.

It normalizes both to one branded canonical string. Empty strings, whitespace-only strings,
fractions, unsafe integers, and other runtime values fail validation.

The initial article reference is intentionally small and strict:

```ts
const FantasyCalendarEventReferenceSchema = z
  .object({
    eventId: FantasyCalendarEventIdSchema,
  })
  .strict();
```

A future event article may compose it as a sibling to world metadata:

```yaml
event:
  # Existing @bastion-falls/types world-event metadata.

fantasyCalendar:
  eventId: "12345"
```

Banner presentation metadata and event reconciliation behavior are explicitly outside this
extraction. They receive their own approved design after the calendar MVP.

## Migration

1. Scaffold `packages/fantasy-calendar` with TypeScript, Zod, the core calendar dependency, build,
   typecheck, and Node test scripts.
1. Move the current CLI Fantasy Calendar client, error class, constants, narrow wire schema, and
   behavioral tests into the package.
1. Add event-ID and article-reference schemas with focused normalization and strictness tests.
1. Keep `cli/src/commands/calendar/settings.ts` and its tests in the CLI.
1. Update the Task 9 resolver and later CLI code to import from
   `@bastion-falls/fantasy-calendar`.
1. Remove the CLI-local `fantasy-calendar.ts` and its test; do not retain a permanent compatibility
   shim for an internal path.
1. Add the new workspace dependency to the CLI, register its Turbo build output, and update the
   lockfile without unrelated dependency churn.
1. Verify package exports from built output, package tests, CLI tests/typecheck/build, formatting,
   and `git diff --check`.
1. Continue Task 10 against the extracted package.

## Error And Dependency Rules

- The package performs network I/O but no filesystem, repository discovery, environment parsing,
  console output, or Astro integration.
- Normal tests inject fetch, sleep, random, and clock seams and never call the live service.
- Existing timeout/retry/error semantics remain behaviorally compatible during extraction.
- Zod validates only provider wire and content-reference boundaries.
- No event list/full-calendar endpoint is introduced by this extraction.

## Testing Strategy

- Move the existing date-client behavioral tests without weakening their assertions.
- Preserve coverage for endpoint identity, timeout, retry classes, jitter bounds, callback failures,
  PF/AI conversion, schema failures, invalid dates, and epoch disagreement.
- Add one compact table for event-ID normalization and rejection.
- Add one strict article-reference test, including unknown-key rejection.
- Build the package before CLI tests so package-local `dist` exports are authoritative.
- Run the complete CLI suite after import migration.

## Explicit Exclusions

This extraction does not:

- fetch Fantasy Calendar events, moons, categories, or full calendar data;
- reconcile event articles;
- add Astro frontmatter fields;
- render event banners;
- trigger deployments when the FC date changes;
- add generalized provider abstraction or multiple calendar-service support;
- modify `@bastion-falls/types`.

## Acceptance Gates

The extraction is complete when:

1. The provider client and its existing tests live in `@bastion-falls/fantasy-calendar`.
1. The CLI imports the package and contains no duplicate provider client implementation.
1. `@bastion-falls/calendar` remains dependency-free at runtime and provider-neutral.
1. Event IDs normalize to branded strings and article references validate through the `/schemas`
   subpath.
1. Built root and `/schemas` exports import successfully.
1. Focused package tests, full CLI tests, typecheck, builds, formatting, and `git diff --check`
   pass.
1. No event-fetching or banner behavior enters the extraction.

## Follow-Up Direction

After the calendar MVP, an event-banner design may compose
`FantasyCalendarEventReferenceSchema` into the Astro event collection. Event articles remain the
canonical public content and presentation source, while Fantasy Calendar owns temporal state.
Deploy-time reconciliation joins the explicit event ID, validates active event timing, and bakes
public banners into the static site.
