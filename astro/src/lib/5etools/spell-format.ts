import { schoolLabel } from "./format-plain.js";

/** Display helpers for SpellData blobs (best-effort vs 5etools time/range shapes). */

export function formatSpellLevelSchoolLine(
  level: number | undefined,
  school: unknown,
  meta: { ritual?: boolean } | undefined,
): string {
  const schName = schoolLabel(typeof school === "string" ? school : "");
  const ritual = meta?.ritual ? " (ritual)" : "";

  if (level == null) return "";
  if (level === 0) {
    return schName ? `${schName} cantrip${ritual}` : `Cantrip${ritual}`;
  }

  const ordinal = (n: number) => {
    const rem10 = n % 10;
    const rem100 = n % 100;
    if (rem10 === 1 && rem100 !== 11) return `${n}st`;
    if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
    if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
    return `${n}th`;
  };

  const ord = ordinal(level);
  if (schName) return `${ord}-level ${schName.toLowerCase()}${ritual}`;
  return `${ord}-level${ritual}`;
}

function capitalizeUnit(unit: string, amount: number): string {
  const n = amount;
  switch (unit) {
    case "bonus":
      return n === 1 ? "bonus action" : "bonus actions";
    case "action":
      return n === 1 ? "action" : "actions";
    case "reaction":
      return n === 1 ? "reaction" : "reactions";
    case "minute":
      return n === 1 ? "minute" : "minutes";
    case "hour":
      return n === 1 ? "hour" : "hours";
    case "round":
      return n === 1 ? "round" : "rounds";
    default:
      return unit.replace(/-/g, " ");
  }
}

/** One casting-time entry common shape: `{ number, unit }`. */
export function formatSpellOneTime(entry: unknown): string {
  if (entry == null || typeof entry !== "object") return "";
  const o = entry as Record<string, unknown>;
  const n = o.number as number | undefined;
  const u = o.unit as string | undefined;
  if (n != null && u) {
    const unitStr = capitalizeUnit(u, n);
    if (n <= 1) return `1 ${unitStr}`;
    return `${n} ${unitStr}`;
  }
  if (typeof o.special === "string") return o.special;
  return "";
}

export function formatSpellTime(time: unknown): string {
  if (!Array.isArray(time) || !time.length) return "—";
  const parts = time.map(formatSpellOneTime).filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

/** Range object from SpellData.range (partial). */
export function formatSpellRange(range: unknown): string {
  if (range == null || typeof range !== "object") return "—";
  const r = range as Record<string, unknown>;
  if (typeof r.special === "string") return r.special;
  const t = typeof r.type === "string" ? r.type : "";
  const d = r.distance as Record<string, unknown> | undefined;
  const amount = typeof d?.amount === "number" ? d.amount : undefined;
  const dtype = typeof d?.type === "string" ? d.type : "";

  const dist =
    amount != null && dtype
      ? dtype === "feet"
        ? `${amount} ft.`
        : dtype === "miles"
          ? `${amount} mi.`
          : `${amount} ${dtype}`
      : "";

  if (t === "point" && dist) return dist;
  if (t && dist) return `${t} (${dist})`;
  if (t) return t;
  return dist || "—";
}

export function formatSpellComponents(
  c: Record<string, unknown> | undefined,
): string {
  if (!c) return "—";
  const bits: string[] = [];
  if (c.v === true) bits.push("V");
  if (c.s === true) bits.push("S");
  if (c.r === true) bits.push("R");
  const m = c.m;
  if (m === true) bits.push("M");
  else if (typeof m === "string") bits.push(`M (${m})`);
  else if (m && typeof m === "object") {
    const mo = m as Record<string, unknown>;
    const text = typeof mo.text === "string" ? mo.text : "";
    const cost = typeof mo.cost === "number" ? ` (${mo.cost} gp)` : "";
    bits.push(`M (${text}${cost})`);
  }
  return bits.length ? bits.join(", ") : "—";
}

/** Best-effort duration line from 5etools duration array. */
export function formatSpellDuration(duration: unknown): string {
  if (!Array.isArray(duration) || !duration.length) return "—";
  const parts: string[] = [];
  for (const d of duration) {
    if (d == null || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    if (typeof o.special === "string") {
      parts.push(o.special);
      continue;
    }
    const type = typeof o.type === "string" ? o.type : "";
    const inner = o.duration as Record<string, unknown> | undefined;
    if (type === "instant") {
      parts.push("Instantaneous");
      continue;
    }
    if (type === "permanent" && typeof o.ends === "string") {
      parts.push(`Until ${o.ends}`);
      continue;
    }
    if (inner && typeof inner.type === "string" && inner.amount != null) {
      const amt = inner.amount as number;
      const ut = inner.type as string;
      parts.push(`${amt} ${capitalizeUnit(ut, amt)}`);
      continue;
    }
    if (type === "timed" && inner) {
      const amt = inner.amount as number | undefined;
      const ut = inner.type as string | undefined;
      if (amt != null && ut) parts.push(`${amt} ${capitalizeUnit(ut, amt)}`);
    }
  }
  return parts.length ? parts.join("; ") : "—";
}
