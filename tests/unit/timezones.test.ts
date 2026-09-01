import { describe, expect, it } from "vitest";
import {
  groupTimeZones,
  isValidTimeZone,
  isoToZonedInput,
  zonedInputToIso,
  zoneAbbreviation,
} from "@/lib/timezones";

describe("zonedInputToIso / isoToZonedInput", () => {
  it("interprets the wall time in the given zone, not the process zone", () => {
    // 10:00 in Amsterdam during CEST (UTC+2) is 08:00Z.
    expect(zonedInputToIso("2026-09-10T10:00", "Europe/Amsterdam")).toBe("2026-09-10T08:00:00.000Z");
    // Same wall time in New York during EDT (UTC-4) is 14:00Z.
    expect(zonedInputToIso("2026-09-10T10:00", "America/New_York")).toBe("2026-09-10T14:00:00.000Z");
  });

  it("round-trips through the input format", () => {
    const iso = zonedInputToIso("2026-01-15T23:30", "Asia/Tokyo");
    expect(isoToZonedInput(iso, "Asia/Tokyo")).toBe("2026-01-15T23:30");
    // The same instant reads as the previous day in New York.
    expect(isoToZonedInput(iso, "America/New_York")).toBe("2026-01-15T09:30");
  });

  it("handles DST boundaries in the zone", () => {
    // Amsterdam is CET (UTC+1) in January.
    expect(zonedInputToIso("2026-01-15T10:00", "Europe/Amsterdam")).toBe("2026-01-15T09:00:00.000Z");
  });

  it("renders a flight's ends in different zones from the same instants", () => {
    // AMS 10:00 CEST → JFK 12:30 EDT the same day is an 8.5h flight.
    const dep = zonedInputToIso("2026-09-10T10:00", "Europe/Amsterdam");
    const arr = zonedInputToIso("2026-09-10T12:30", "America/New_York");
    expect((new Date(arr).getTime() - new Date(dep).getTime()) / 3.6e6).toBe(8.5);
    expect(isoToZonedInput(arr, "America/New_York")).toBe("2026-09-10T12:30");
  });

  it("returns empty for missing or invalid input", () => {
    expect(isoToZonedInput(null, "UTC")).toBe("");
    expect(isoToZonedInput("not a date", "UTC")).toBe("");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA ids and rejects junk", () => {
    expect(isValidTimeZone("Europe/Amsterdam")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});

describe("zoneAbbreviation", () => {
  it("gives a short label that reflects DST", () => {
    expect(zoneAbbreviation("2026-09-10T08:00:00Z", "Europe/Amsterdam", "en-GB")).toBe("CEST");
    expect(zoneAbbreviation("2026-01-15T08:00:00Z", "Europe/Amsterdam", "en-GB")).toBe("CET");
    expect(zoneAbbreviation("2026-09-10T08:00:00Z", "America/New_York", "en-US")).toBe("EDT");
  });
});

describe("groupTimeZones", () => {
  it("buckets by region with readable labels and keeps an unknown current value", () => {
    const groups = groupTimeZones("Custom/Zone_Name");
    const europe = groups.find((g) => g.region === "Europe");
    expect(europe?.zones.some((z) => z.id === "Europe/Amsterdam" && z.label === "Amsterdam")).toBe(true);
    const custom = groups.find((g) => g.region === "Custom");
    expect(custom?.zones[0]).toEqual({ id: "Custom/Zone_Name", label: "Zone Name" });
    expect(groups[groups.length - 1].region).toBe("Other");
  });
});
