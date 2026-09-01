import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Wall-clock format produced/consumed by <input type="datetime-local">.
const INPUT_FORMAT = "yyyy-MM-dd'T'HH:mm";

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// "2026-09-10T10:00" typed as Amsterdam local → the absolute instant it names.
export function zonedInputToIso(input: string, tz: string): string {
  return fromZonedTime(input, tz).toISOString();
}

// The inverse: an absolute instant → the wall-clock string to put in the
// input for zone `tz`. Empty string for missing/invalid input.
export function isoToZonedInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatInTimeZone(d, tz, INPUT_FORMAT);
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Short zone label for a given instant, e.g. "CEST" or "GMT+2" — which one
// you get depends on the locale's CLDR data, both are unambiguous enough.
export function zoneAbbreviation(at: Date | string, tz: string, locale?: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "";
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

const FALLBACK_ZONES = [
  "UTC",
  "Europe/Amsterdam",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Lisbon",
  "Europe/Athens",
  "Europe/Istanbul",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Africa/Johannesburg",
  "Africa/Cairo",
];

let cachedZones: string[] | null = null;

// Every IANA zone the runtime knows about, sorted. Falls back to a curated
// list on engines without Intl.supportedValuesOf.
export function listTimeZones(): string[] {
  if (cachedZones) return cachedZones;
  let zones: string[] = FALLBACK_ZONES;
  try {
    const supported = Intl.supportedValuesOf?.("timeZone");
    if (supported?.length) zones = supported.includes("UTC") ? supported : ["UTC", ...supported];
  } catch {
    // keep fallback
  }
  cachedZones = [...zones].sort();
  return cachedZones;
}

export type TimeZoneGroup = { region: string; zones: { id: string; label: string }[] };

// Zones bucketed by their leading region ("Europe", "America", …) with the
// city part made readable — what the picker renders as <optgroup>s.
export function groupTimeZones(extra?: string | null): TimeZoneGroup[] {
  const ids = new Set(listTimeZones());
  if (extra) ids.add(extra);
  const byRegion = new Map<string, { id: string; label: string }[]>();
  for (const id of [...ids].sort()) {
    const slash = id.indexOf("/");
    const region = slash === -1 ? "Other" : id.slice(0, slash);
    const label = (slash === -1 ? id : id.slice(slash + 1)).replace(/_/g, " ");
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push({ id, label });
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([region, zones]) => ({ region, zones }));
}
