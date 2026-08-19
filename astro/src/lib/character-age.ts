import { BastionDate, type CalendarDate } from "@bastion-falls/calendar";

export interface CharacterAgeDetails {
  readonly age?: number;
  readonly dateOfBirth?: string;
  readonly dateOfDeath?: string;
  readonly mortality?: "alive" | "dead" | "undead" | "unknown";
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

export function canResolveCharacterAge(details: CharacterAgeDetails): boolean {
  return (
    details.age === undefined &&
    hasText(details.dateOfBirth) &&
    (details.mortality !== "dead" || hasText(details.dateOfDeath))
  );
}

export function resolveCharacterAge(
  details: CharacterAgeDetails,
  currentDate: CalendarDate,
): number | undefined {
  if (details.age !== undefined) return details.age;
  if (details.dateOfBirth === undefined) return undefined;

  try {
    const birthDate = BastionDate.from(details.dateOfBirth);
    if (birthDate.precision !== "day") return undefined;

    const referenceDate =
      details.mortality === "dead"
        ? details.dateOfDeath === undefined
          ? undefined
          : BastionDate.from(details.dateOfDeath)
        : currentDate;
    if (referenceDate === undefined || referenceDate.precision !== "day") {
      return undefined;
    }

    return birthDate.ageOn(referenceDate);
  } catch {
    return undefined;
  }
}
