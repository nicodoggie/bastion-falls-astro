import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bastionCalendar, CalendarDate } from "@bastion-falls/calendar";
import {
  createBastionNow,
  resolveBastionCalendarStatePath,
} from "./bastion-now.ts";

const source = {
  provider: "fantasy-calendar",
  identifier: "089e518f9ea966373b1c71535c25b98a",
  endpoint:
    "https://app.fantasy-calendar.com/api/v1/calendar/089e518f9ea966373b1c71535c25b98a/dynamic_data",
};

const state = {
  calendarId: "bastion",
  date: { era: "AI", year: 1275, month: 9, day: 25, epochDay: 459264 },
  metadata: { source: "live" },
  retrievedAt: "2026-08-19T12:03:06.640Z",
  schemaVersion: 1,
  source,
};

function cloneState(): typeof state {
  return structuredClone(state);
}

function assertBastionNowError(action: () => unknown, message: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, message);
    return true;
  });
}

describe("createBastionNow", () => {
  it("anchors generated state to the Astro package working directory", () => {
    assert.equal(
      resolveBastionCalendarStatePath("/repo/astro"),
      "/repo/astro/.astro/bastion-calendar-state.json",
    );
  });

  it("returns an immutable CalendarDate from valid in-memory state", () => {
    const date = createBastionNow(() => cloneState()).date();

    assert.ok(date instanceof CalendarDate);
    assert.ok(date.isBoundTo(bastionCalendar));
    assert.equal(Object.isFrozen(date), true);
    assert.deepEqual(date.fields, { era: "AI", year: 1275, month: 9, day: 25 });
  });

  it("rejects missing, malformed, and mismatched calendar state deliberately", () => {
    assertBastionNowError(
      () => createBastionNow(() => undefined).date(),
      /loader returned no state/,
    );
    assertBastionNowError(
      () => createBastionNow(() => ({ ...cloneState(), date: null })).date(),
      /invalid calendar state/,
    );
    assertBastionNowError(
      () =>
        createBastionNow(() => ({
          ...cloneState(),
          calendarId: "other",
        })).date(),
      /invalid calendar state/,
    );
  });

  it("rejects any unexpected source provider, identifier, or endpoint", () => {
    for (const field of ["provider", "identifier", "endpoint"] as const) {
      assertBastionNowError(
        () =>
          createBastionNow(() => ({
            ...cloneState(),
            source: { ...source, [field]: "unexpected" },
          })).date(),
        new RegExp(`source ${field} mismatch`),
      );
    }
  });

  it("rejects disagreement between date fields and epoch day", () => {
    assertBastionNowError(
      () =>
        createBastionNow(() => ({
          ...cloneState(),
          date: { ...state.date, day: 24 },
        })).date(),
      /invalid calendar state/,
    );
  });

  it("memoizes only after successful validation", () => {
    let loads = 0;
    const now = createBastionNow(() => {
      loads += 1;
      return cloneState();
    });

    const first = now.date();
    const second = now.date();

    assert.equal(loads, 1);
    assert.strictEqual(first, second);
  });

  it("retries after a failed load instead of poisoning the cache", () => {
    let loads = 0;
    const now = createBastionNow(() => {
      loads += 1;
      return loads === 1 ? undefined : cloneState();
    });

    assertBastionNowError(() => now.date(), /loader returned no state/);
    const date = now.date();

    assert.equal(loads, 2);
    assert.equal(date.epochDay, state.date.epochDay);
  });
});
