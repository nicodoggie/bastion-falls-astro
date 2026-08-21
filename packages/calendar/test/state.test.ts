import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BastionDate,
  bastionCalendar,
  defineCalendar,
  parseCalendarState,
  serializeCalendarState,
} from "../src/index.js";

const source = {
  provider: "fantasy-calendar",
  identifier: "campaign-42",
  endpoint: "https://example.test/calendar/42",
};
const retrievedAt = "2026-08-19T02:26:18.000Z";
const metadata = { diagnostic: "cache-hit", nested: { ok: true }, values: [1, "two"] };

function validState() {
  return serializeCalendarState(
    bastionCalendar,
    source,
    BastionDate.from({ era: "AI", year: 1275, month: 9, day: 25 }),
    retrievedAt,
    metadata,
  );
}

function assertRangeError(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof RangeError);
}

describe("serialized calendar state", () => {
  it("serializes and parses a valid state", () => {
    const state = validState();
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.calendarId, "bastion");
    assert.deepEqual(parseCalendarState(bastionCalendar, state), state);
    assert.deepEqual(state.date, {
      era: "AI", year: 1275, month: 9, day: 25, epochDay: 459264,
    });
  });

  it("rejects unsupported schema versions and calendar mismatches", () => {
    const state = validState();
    assertRangeError(() => parseCalendarState(bastionCalendar, { ...state, schemaVersion: 2 }));
    assertRangeError(() => parseCalendarState(bastionCalendar, { ...state, calendarId: "other" }));
  });

  it("rejects missing or empty source fields and malformed timestamps", () => {
    const state = validState();
    for (const field of ["provider", "identifier", "endpoint"] as const) {
      const bad = { ...state, source: { ...state.source, [field]: "" } };
      assertRangeError(() => parseCalendarState(bastionCalendar, bad));
      const missing = { ...state, source: Object.fromEntries(
        Object.entries(state.source).filter(([key]) => key !== field),
      ) };
      assertRangeError(() => parseCalendarState(bastionCalendar, missing));
    }
    assertRangeError(() => parseCalendarState(bastionCalendar, { ...state, retrievedAt: "yesterday" }));
    assertRangeError(() => parseCalendarState(bastionCalendar, {
      ...state,
      retrievedAt: "2026-02-30T02:26:18Z",
    }));
    assertRangeError(() => parseCalendarState(bastionCalendar, {
      ...state,
      retrievedAt: "2026-13-01T02:26:18Z",
    }));

    const offsetTimestamp = "2026-08-19T10:26:18+08:00";
    assert.equal(parseCalendarState(bastionCalendar, {
      ...state,
      retrievedAt: offsetTimestamp,
    }).retrievedAt, offsetTimestamp);
  });

  it("rejects disagreement between date fields and epoch day", () => {
    const state = validState();
    assertRangeError(() => parseCalendarState(bastionCalendar, {
      ...state, date: { ...state.date, day: 24 },
    }));
  });

  it("rejects unknown top-level and date fields", () => {
    const state = validState();
    assertRangeError(() => parseCalendarState(bastionCalendar, { ...state, extra: true }));
    assertRangeError(() => parseCalendarState(bastionCalendar, {
      ...state, date: { ...state.date, extra: true },
    }));
  });

  it("keeps diagnostic metadata open while rejecting malformed boundaries", () => {
    const state = validState();
    assert.deepEqual(state.metadata, metadata);
    for (const input of [null, [], "state", { ...state, source: null }, { ...state, date: [] }]) {
      assertRangeError(() => parseCalendarState(bastionCalendar, input));
    }
    assertRangeError(() => serializeCalendarState(bastionCalendar, source, BastionDate.from("1275 AI"), retrievedAt, metadata));
    assertRangeError(() => parseCalendarState(bastionCalendar, { ...state, metadata: { bad: undefined } }));
  });

  it("rejects invalid calendar and date arguments deliberately", () => {
    const state = validState();
    for (const calendar of [null, undefined, {}]) {
      assertRangeError(() => parseCalendarState(calendar as never, state));
    }

    const revokedCalendar = Proxy.revocable({}, {});
    revokedCalendar.revoke();
    assertRangeError(() => parseCalendarState(revokedCalendar.proxy as never, state));

    const revokedDate = Proxy.revocable({}, {});
    revokedDate.revoke();
    assertRangeError(() => serializeCalendarState(
      bastionCalendar,
      source,
      revokedDate.proxy as never,
      retrievedAt,
      metadata,
    ));
  });

  it("rejects object and array accessors or proxies without invoking user code", () => {
    const state = validState();
    let getterCalls = 0;
    const accessorMetadata = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "unsafe";
      },
    });
    assertRangeError(() => parseCalendarState(bastionCalendar, {
      ...state,
      metadata: accessorMetadata,
    }));
    assert.equal(getterCalls, 0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    assertRangeError(() => parseCalendarState(bastionCalendar, revoked.proxy));

    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "unsafe";
      },
    });
    assertRangeError(() => parseCalendarState(bastionCalendar, {
      ...state,
      metadata: { values: accessorArray },
    }));
    assert.equal(getterCalls, 0);

    const revokedArray = Proxy.revocable([], {});
    revokedArray.revoke();
    assertRangeError(() => parseCalendarState(bastionCalendar, {
      ...state,
      metadata: { values: revokedArray.proxy },
    }));
  });

  it("rejects dates bound to a distinct same-ID calendar", () => {
    const otherCalendar = defineCalendar(bastionCalendar.definition);
    const otherDate = otherCalendar.dateFrom({
      era: "AI",
      year: 1275,
      month: 9,
      day: 25,
    });

    assertRangeError(() => serializeCalendarState(
      bastionCalendar,
      source,
      otherDate,
      retrievedAt,
      metadata,
    ));
  });

  it("rejects cyclic and non-finite metadata through parse and serialize", () => {
    const state = validState();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    for (const invalidMetadata of [cyclic, { value: Number.NaN }, { value: Infinity }, { value: -Infinity }]) {
      assertRangeError(() => parseCalendarState(bastionCalendar, {
        ...state,
        metadata: invalidMetadata,
      }));
      assertRangeError(() => serializeCalendarState(
        bastionCalendar,
        source,
        BastionDate.from({ era: "AI", year: 1275, month: 9, day: 25 }),
        retrievedAt,
        invalidMetadata,
      ));
    }
  });

  it("preserves __proto__ as ordinary open JSON metadata", () => {
    const protoMetadata = JSON.parse('{"__proto__":{"safe":true}}') as Record<string, unknown>;
    const state = serializeCalendarState(
      bastionCalendar,
      source,
      BastionDate.from({ era: "AI", year: 1275, month: 9, day: 25 }),
      retrievedAt,
      protoMetadata,
    );

    assert.equal(Object.hasOwn(state.metadata, "__proto__"), true);
    assert.deepEqual(state.metadata["__proto__"], { safe: true });
    assert.equal(Object.getPrototypeOf(state.metadata), Object.prototype);
  });

  it("defensively copies and freezes serialized output and nested metadata", () => {
    const mutableSource = { ...source };
    const mutableMetadata = { nested: { value: 1 }, values: [{ value: 2 }] };
    const state = serializeCalendarState(
      bastionCalendar,
      mutableSource,
      BastionDate.from({ era: "AI", year: 1275, month: 9, day: 25 }),
      retrievedAt,
      mutableMetadata,
    );
    mutableSource.provider = "changed";
    mutableMetadata.nested.value = 9;
    (mutableMetadata.values[0] as { value: number }).value = 9;
    assert.equal(state.source.provider, source.provider);
    assert.equal((state.metadata.nested as { value: number }).value, 1);
    assert.equal((state.metadata.values as Array<{ value: number }>)[0]?.value, 2);
    assert.ok(Object.isFrozen(state));
    assert.ok(Object.isFrozen(state.source));
    assert.ok(Object.isFrozen(state.date));
    assert.ok(Object.isFrozen(state.metadata));
    assert.ok(Object.isFrozen(state.metadata.nested));
    assert.ok(Object.isFrozen(state.metadata.values));
  });
});
