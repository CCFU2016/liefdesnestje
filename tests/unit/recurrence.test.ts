import { describe, it, expect } from "vitest";
import { expandRule, nextTodoOccurrence } from "@/lib/recurrence";

describe("recurrence", () => {
  describe("nextTodoOccurrence", () => {
    it("returns the next day for FREQ=DAILY", () => {
      const lastDue = new Date("2026-04-20T09:00:00Z");
      const now = new Date("2026-04-20T10:00:00Z");
      const next = nextTodoOccurrence("FREQ=DAILY", lastDue, now);
      expect(next).not.toBeNull();
      expect(next!.toISOString()).toBe("2026-04-21T09:00:00.000Z");
    });

    it("skips weekends for weekday rule", () => {
      // 2026-04-24 is Friday → next weekday is Monday 2026-04-27
      const lastDue = new Date("2026-04-24T09:00:00Z");
      const now = new Date("2026-04-24T10:00:00Z");
      const next = nextTodoOccurrence("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", lastDue, now);
      expect(next).not.toBeNull();
      expect(next!.getUTCDay()).toBe(1); // Monday
    });

    it("handles late completion without double-firing", () => {
      // User completed yesterday's daily todo today — next should be tomorrow, not today
      const lastDue = new Date("2026-04-19T09:00:00Z");
      const now = new Date("2026-04-21T15:00:00Z");
      const next = nextTodoOccurrence("FREQ=DAILY", lastDue, now);
      expect(next).not.toBeNull();
      expect(next!.getUTCDate()).toBe(22);
    });

    it("returns null for invalid rules", () => {
      const next = nextTodoOccurrence("NOT_A_RULE", new Date(), new Date());
      expect(next).toBeNull();
    });
  });

  describe("expandRule", () => {
    it("expands weekly rule across a 4-week window", () => {
      const dtstart = new Date("2026-04-20T09:00:00Z"); // Monday
      const from = new Date("2026-04-20T00:00:00Z");
      const to = new Date("2026-05-18T00:00:00Z");
      const occurrences = expandRule("FREQ=WEEKLY", dtstart, from, to);
      expect(occurrences.length).toBe(4);
    });
  });
});
