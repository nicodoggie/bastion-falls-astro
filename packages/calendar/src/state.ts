import { CalendarDate, type CompleteDateFields } from "./date.js";
import { CalendarSystem } from "./definition.js";

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

const topLevelFields = new Set([
  "schemaVersion", "calendarId", "source", "date", "retrievedAt", "metadata",
]);
const sourceFields = new Set(["provider", "identifier", "endpoint"]);
const dateFields = new Set(["era", "year", "month", "day", "epochDay"]);

function fail(message: string): never {
  throw new RangeError(`invalid serialized calendar state: ${message}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    fail(`${field} must be a plain object`);
  }

  let array: boolean;
  let prototype: object | null;
  let keys: (string | symbol)[];
  try {
    array = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(`${field} must be an inspectable plain object`);
  }
  if (array || (prototype !== Object.prototype && prototype !== null)) {
    fail(`${field} must be a plain object`);
  }

  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string") fail(`${field} contains an unsupported symbol key`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail(`${field}.${key} cannot be inspected`);
    }
    if (descriptor === undefined) fail(`${field}.${key} cannot be inspected`);
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(`${field}.${key} must be a data property`);
    }
    if (descriptor.enumerable) {
      Object.defineProperty(copy, key, {
        value: descriptor.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return copy;
}

function exactFields(value: Record<string, unknown>, allowed: Set<string>, field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field}.${key} is not recognized`);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function safeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) fail(`${field} must be a safe integer`);
  return value as number;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") fail("retrievedAt must be an ISO timestamp");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) fail("retrievedAt must be an ISO timestamp");

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    hourText === undefined ||
    minuteText === undefined ||
    secondText === undefined ||
    zone === undefined
  ) {
    fail("retrievedAt must be an ISO timestamp");
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const monthLength = monthLengths[month - 1];
  if (
    monthLength === undefined ||
    day < 1 ||
    day > monthLength ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    fail("retrievedAt must be an ISO timestamp");
  }
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) fail("retrievedAt must be an ISO timestamp");
  }
  if (!Number.isFinite(new Date(value).getTime())) fail("retrievedAt must be an ISO timestamp");
  return value;
}

function validateCalendar(value: unknown): CalendarSystem {
  let valid = false;
  try {
    valid = value instanceof CalendarSystem;
  } catch {
    valid = false;
  }
  if (!valid) fail("calendar must be a CalendarSystem");
  return value as CalendarSystem;
}

function isCalendarDate(value: unknown): value is CalendarDate {
  try {
    return value instanceof CalendarDate;
  } catch {
    return false;
  }
}

function cloneJsonArray(
  value: object,
  field: string,
  seen: WeakSet<object>,
): readonly unknown[] {
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail(`${field} must be an inspectable array`);
  }

  const entries = new Map<number, unknown>();
  let length: number | undefined;
  for (const key of keys) {
    if (typeof key !== "string") fail(`${field} contains an unsupported symbol key`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail(`${field}.${key} cannot be inspected`);
    }
    if (descriptor === undefined) fail(`${field}.${key} cannot be inspected`);
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(`${field}.${key} must be a data property`);
    }
    if (key === "length") {
      length = descriptor.value as number;
      continue;
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key) {
      fail(`${field}.${key} is not a JSON array index`);
    }
    entries.set(index, descriptor.value);
  }
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    fail(`${field}.length must be a safe non-negative integer`);
  }

  const copy: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    if (!entries.has(index)) fail(`${field} must not be sparse`);
    copy.push(cloneJson(entries.get(index), `${field}[${index}]`, seen));
  }
  return Object.freeze(copy);
}

function cloneJson(value: unknown, field: string, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${field} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object") fail(`${field} contains an unsupported value`);
  let array: boolean;
  try {
    array = Array.isArray(value);
  } catch {
    fail(`${field} must be inspectable JSON data`);
  }
  if (seen.has(value)) fail(`${field} contains a cycle`);
  seen.add(value);
  let result: unknown;
  if (array) {
    result = cloneJsonArray(value, field, seen);
  } else {
    const source = record(value, field);
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      Object.defineProperty(copy, key, {
        value: cloneJson(source[key], `${field}.${key}`, seen),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    result = Object.freeze(copy);
  }
  seen.delete(value);
  return result;
}

function metadata(value: unknown): Readonly<Record<string, unknown>> {
  const cloned = cloneJson(record(value, "metadata"), "metadata");
  return cloned as Readonly<Record<string, unknown>>;
}

function validateSource(value: unknown): SerializedCalendarState["source"] {
  const source = record(value, "source");
  exactFields(source, sourceFields, "source");
  return Object.freeze({
    provider: requiredString(source["provider"], "source.provider"),
    identifier: requiredString(source["identifier"], "source.identifier"),
    endpoint: requiredString(source["endpoint"], "source.endpoint"),
  });
}

function validateDate(calendar: CalendarSystem, value: unknown): SerializedCalendarState["date"] {
  const input = record(value, "date");
  exactFields(input, dateFields, "date");
  const fields = {
    era: requiredString(input["era"], "date.era"),
    year: safeInteger(input["year"], "date.year"),
    month: safeInteger(input["month"], "date.month"),
    day: safeInteger(input["day"], "date.day"),
  } satisfies CompleteDateFields;
  const date = calendar.dateFrom(fields);
  const epochDay = safeInteger(input["epochDay"], "date.epochDay");
  if (date.epochDay !== epochDay) fail("date fields disagree with date.epochDay");
  return Object.freeze({ ...date.fields as CompleteDateFields, epochDay: date.epochDay });
}

export function parseCalendarState(
  calendar: CalendarSystem,
  input: unknown,
): SerializedCalendarState {
  validateCalendar(calendar);
  const state = record(input, "state");
  exactFields(state, topLevelFields, "state");
  if (state["schemaVersion"] !== 1) fail("schemaVersion must be 1");
  if (state["calendarId"] !== calendar.definition.id) fail("calendarId does not match calendar");
  const result = {
    schemaVersion: 1 as const,
    calendarId: requiredString(state["calendarId"], "calendarId"),
    source: validateSource(state["source"]),
    date: validateDate(calendar, state["date"]),
    retrievedAt: timestamp(state["retrievedAt"]),
    metadata: metadata(state["metadata"]),
  };
  return Object.freeze(result);
}

export function serializeCalendarState(
  calendar: CalendarSystem,
  source: unknown,
  date: CalendarDate,
  retrievedAt: unknown,
  metadataValue: unknown,
): SerializedCalendarState {
  validateCalendar(calendar);
  if (!isCalendarDate(date) || !date.isBoundTo(calendar)) {
    fail("date does not belong to calendar");
  }
  const fields = date.fields;
  if (date.precision !== "day") fail("date must have day precision");
  return Object.freeze({
    schemaVersion: 1 as const,
    calendarId: calendar.definition.id,
    source: validateSource(source),
    date: validateDate(calendar, { ...fields as CompleteDateFields, epochDay: date.epochDay }),
    retrievedAt: timestamp(retrievedAt),
    metadata: metadata(metadataValue),
  });
}
