import { describe, expect, it } from "vitest";
import {
  addDays,
  choreOccursOn,
  dayOfWeek,
  missedDatesForCarryover,
  weekEnd,
  weekStart,
} from "@/lib/chores/schedule";

describe("schedule helpers", () => {
  it("dayOfWeek matches JS Date getDay (0=Sunday)", () => {
    expect(dayOfWeek("2026-04-26")).toBe(0); // Sunday
    expect(dayOfWeek("2026-04-27")).toBe(1); // Monday
    expect(dayOfWeek("2026-04-30")).toBe(4); // Thursday
  });

  it("choreOccursOn respects daysOfWeek + window", () => {
    // Mon/Wed/Fri = 1, 3, 5 — chore active throughout April 2026.
    const chore = {
      daysOfWeek: [1, 3, 5],
      startsOn: "2026-04-01",
      endsOn: "2026-05-31",
      rollsOver: false,
      rollsOverSince: null,
    };
    // Wed Apr 1 — yes
    expect(choreOccursOn(chore, "2026-04-01")).toBe(true);
    // Thu Apr 2 — wrong day
    expect(choreOccursOn(chore, "2026-04-02")).toBe(false);
    // Fri Apr 3 — yes
    expect(choreOccursOn(chore, "2026-04-03")).toBe(true);
    // Mon Apr 6 — yes
    expect(choreOccursOn(chore, "2026-04-06")).toBe(true);
    // Sun Apr 5 — no
    expect(choreOccursOn(chore, "2026-04-05")).toBe(false);
    // Out of window — Mon March 30 (before startsOn)
    expect(choreOccursOn(chore, "2026-03-30")).toBe(false);
    // Out of window — Mon June 1 (after endsOn)
    expect(choreOccursOn(chore, "2026-06-01")).toBe(false);
  });

  it("addDays handles month / year crossings", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("missedDatesForCarryover", () => {
  it("returns nothing when rollsOver is off", () => {
    const r = missedDatesForCarryover(
      {
        daysOfWeek: [4],
        startsOn: null,
        endsOn: null,
        rollsOver: false,
        rollsOverSince: null,
      },
      new Set<string>(),
      "2026-04-30"
    );
    expect(r).toEqual([]);
  });

  it("returns missed Thursdays since rollsOverSince, excluding today and completed dates", () => {
    // Brief's example: Thursday-only chore (4), rollsOverSince 2026-04-09,
    // completed only 2026-04-09, today is 2026-04-30. Should yield
    // 2026-04-16 and 2026-04-23 in chronological order — NOT 2026-04-09
    // (completed) and NOT 2026-04-30 (today's scheduled row, not carryover).
    const r = missedDatesForCarryover(
      {
        daysOfWeek: [4],
        startsOn: null,
        endsOn: null,
        rollsOver: true,
        rollsOverSince: "2026-04-09",
      },
      new Set(["2026-04-09"]),
      "2026-04-30"
    );
    expect(r).toEqual(["2026-04-16", "2026-04-23"]);
  });

  it("caps lookback at 60 days", () => {
    // Daily chore (every day) that started a year ago, with no completions.
    // Lookback floor is today - 60d = 2026-02-28 inclusive. So we expect
    // exactly 60 entries: from 2026-02-28 through 2026-04-28 inclusive.
    // Today is 2026-04-29, yesterday is 2026-04-28.
    const r = missedDatesForCarryover(
      {
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startsOn: "2025-01-01",
        endsOn: null,
        rollsOver: true,
        rollsOverSince: "2025-01-01",
      },
      new Set<string>(),
      "2026-04-29"
    );
    expect(r.length).toBe(60);
    expect(r[0]).toBe("2026-02-28");
    expect(r[r.length - 1]).toBe("2026-04-28");
  });

  it("respects endsOn upper bound", () => {
    // Daily chore that ended 2026-04-15 — nothing past that should appear.
    const r = missedDatesForCarryover(
      {
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startsOn: null,
        endsOn: "2026-04-15",
        rollsOver: true,
        rollsOverSince: "2026-04-10",
      },
      new Set<string>(),
      "2026-04-30"
    );
    // Should only include 2026-04-10 .. 2026-04-15.
    expect(r[0]).toBe("2026-04-10");
    expect(r[r.length - 1]).toBe("2026-04-15");
    expect(r.length).toBe(6);
  });

  it("never includes today (today is a 'scheduled today' row, not carryover)", () => {
    const r = missedDatesForCarryover(
      {
        daysOfWeek: [4], // Thursday
        startsOn: null,
        endsOn: null,
        rollsOver: true,
        rollsOverSince: "2026-04-23",
      },
      new Set<string>(),
      "2026-04-30" // Thursday
    );
    expect(r).not.toContain("2026-04-30");
    // 2026-04-23 was the previous Thursday, no completion → carryover.
    expect(r).toEqual(["2026-04-23"]);
  });
});

describe("weekStart / weekEnd", () => {
  it("Monday-anchored ISO week", () => {
    expect(weekStart("2026-04-30")).toBe("2026-04-27"); // Thu → previous Mon
    expect(weekStart("2026-04-27")).toBe("2026-04-27"); // Mon → itself
    expect(weekStart("2026-04-26")).toBe("2026-04-20"); // Sun → previous Mon
    expect(weekEnd("2026-04-27")).toBe("2026-05-03");
  });
});
