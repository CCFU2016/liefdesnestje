import { describe, expect, it } from "vitest";
import { RRule } from "rrule";
import {
  expandRule,
  isRuleFrequencyAllowed,
  readTextCapped,
  FeedTooLargeError,
  MAX_OCCURRENCES_PER_EVENT,
} from "@/lib/ics/limits";

const start = new Date("2026-01-01T00:00:00Z");
const end = new Date("2026-12-31T00:00:00Z");

describe("isRuleFrequencyAllowed", () => {
  it("allows yearly through daily", () => {
    for (const freq of [RRule.YEARLY, RRule.MONTHLY, RRule.WEEKLY, RRule.DAILY]) {
      expect(isRuleFrequencyAllowed(new RRule({ freq, dtstart: start }))).toBe(true);
    }
  });
  it("rejects hourly, minutely, secondly", () => {
    for (const freq of [RRule.HOURLY, RRule.MINUTELY, RRule.SECONDLY]) {
      expect(isRuleFrequencyAllowed(new RRule({ freq, dtstart: start }))).toBe(false);
    }
  });
});

describe("expandRule", () => {
  it("expands a weekly rule normally", () => {
    const dates = expandRule(new RRule({ freq: RRule.WEEKLY, dtstart: start }), start, end);
    expect(dates.length).toBe(53);
  });
  it("caps a daily rule at the per-event maximum", () => {
    const farEnd = new Date("2036-01-01T00:00:00Z");
    const dates = expandRule(new RRule({ freq: RRule.DAILY, dtstart: start }), start, farEnd);
    expect(dates.length).toBe(MAX_OCCURRENCES_PER_EVENT);
  });
  it("returns nothing for a SECONDLY rule instead of exploding", () => {
    const t0 = Date.now();
    const dates = expandRule(new RRule({ freq: RRule.SECONDLY, dtstart: start }), start, end);
    expect(dates).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe("readTextCapped", () => {
  function streamOf(parts: string[]): Response {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(enc.encode(p));
        controller.close();
      },
    });
    return new Response(stream);
  }
  it("reads a small body", async () => {
    expect(await readTextCapped(streamOf(["BEGIN:", "VCALENDAR"]), 1024)).toBe("BEGIN:VCALENDAR");
  });
  it("throws once the cap is exceeded without reading the rest", async () => {
    const big = "x".repeat(600);
    await expect(readTextCapped(streamOf([big, big, big]), 1000)).rejects.toBeInstanceOf(FeedTooLargeError);
  });
});
