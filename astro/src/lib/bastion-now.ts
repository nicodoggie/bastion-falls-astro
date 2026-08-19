import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  bastionCalendar,
  type CalendarDate,
  parseCalendarState,
} from "@bastion-falls/calendar";

const EXPECTED_SOURCE = Object.freeze({
  provider: "fantasy-calendar",
  identifier: "089e518f9ea966373b1c71535c25b98a",
  endpoint:
    "https://app.fantasy-calendar.com/api/v1/calendar/089e518f9ea966373b1c71535c25b98a/dynamic_data",
});

export function resolveBastionCalendarStatePath(
  currentPath = process.cwd(),
): string {
  return resolve(currentPath, ".astro/bastion-calendar-state.json");
}

function loadLocalState(): unknown {
  const path = resolveBastionCalendarStatePath();
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RangeError(
      `BastionNow: unable to load local calendar state: ${detail}`,
    );
  }
}

function invalidState(error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  throw new RangeError(`BastionNow: invalid calendar state: ${detail}`);
}

function validatedDate(loadState: () => unknown): CalendarDate {
  const input = loadState();
  if (input === undefined || input === null) {
    throw new RangeError("BastionNow: loader returned no state");
  }

  let state: ReturnType<typeof parseCalendarState>;
  try {
    state = parseCalendarState(bastionCalendar, input);
  } catch (error) {
    invalidState(error);
  }

  for (const field of ["provider", "identifier", "endpoint"] as const) {
    if (state.source[field] !== EXPECTED_SOURCE[field]) {
      throw new RangeError(`BastionNow: source ${field} mismatch`);
    }
  }

  try {
    return bastionCalendar.dateFrom(state.date);
  } catch (error) {
    invalidState(error);
  }
}

export function createBastionNow(loadState: () => unknown): {
  date(): CalendarDate;
} {
  let cached: CalendarDate | undefined;

  return {
    date(): CalendarDate {
      if (cached === undefined) {
        cached = validatedDate(loadState);
      }
      return cached;
    },
  };
}

export const BastionNow = createBastionNow(loadLocalState);
