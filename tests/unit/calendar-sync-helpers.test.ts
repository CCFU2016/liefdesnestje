import { describe, expect, it } from "vitest";
import {
  advisoryLockAcquired,
  DELTA_LOOKAHEAD_MS,
  DELTA_LOOKBACK_MS,
  deltaWindowFor,
  isRemovedMsEvent,
  shouldResetDeltaWindow,
  staleLocalEventIds,
} from "@/lib/calendar-sync/helpers";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-04T12:00:00Z");

describe("shouldResetDeltaWindow", () => {
  it("resets legacy rows that never recorded a window end", () => {
    expect(shouldResetDeltaWindow(null, now)).toBe(true);
    expect(shouldResetDeltaWindow(undefined, now)).toBe(true);
  });

  it("keeps the deltaLink while the window still reaches 90 days ahead", () => {
    expect(shouldResetDeltaWindow(new Date(now.getTime() + 365 * DAY), now)).toBe(false);
    expect(shouldResetDeltaWindow(new Date(now.getTime() + 91 * DAY), now)).toBe(false);
  });

  it("resets once the window end is within 90 days (or already past)", () => {
    expect(shouldResetDeltaWindow(new Date(now.getTime() + 89 * DAY), now)).toBe(true);
    expect(shouldResetDeltaWindow(new Date(now.getTime() + 90 * DAY - 1), now)).toBe(true);
    expect(shouldResetDeltaWindow(new Date(now.getTime() - DAY), now)).toBe(true);
  });

  it("a freshly minted window is not immediately reset", () => {
    const { end } = deltaWindowFor(now);
    expect(end.getTime() - now.getTime()).toBe(DELTA_LOOKAHEAD_MS);
    expect(shouldResetDeltaWindow(end, now)).toBe(false);
    // ...and is reset ~275 days later, well before the edge.
    expect(shouldResetDeltaWindow(end, new Date(now.getTime() + 276 * DAY))).toBe(true);
  });

  it("deltaWindowFor looks back the configured amount", () => {
    const { start } = deltaWindowFor(now);
    expect(now.getTime() - start.getTime()).toBe(DELTA_LOOKBACK_MS);
  });
});

describe("isRemovedMsEvent", () => {
  it("treats @removed and isCancelled alike", () => {
    expect(isRemovedMsEvent({ "@removed": { reason: "deleted" } })).toBe(true);
    expect(isRemovedMsEvent({ isCancelled: true })).toBe(true);
    expect(isRemovedMsEvent({ isCancelled: false })).toBe(false);
    expect(isRemovedMsEvent({})).toBe(false);
  });
});

describe("staleLocalEventIds", () => {
  const existing = [
    { id: "a", externalId: "x1", startsAt: new Date(now.getTime() + 5 * DAY) }, // seen
    { id: "b", externalId: "x2", startsAt: new Date(now.getTime() + 5 * DAY) }, // stale, in window
    { id: "c", externalId: "x3", startsAt: new Date(now.getTime() - 200 * DAY) }, // before window
    { id: "d", externalId: "x4", startsAt: new Date(now.getTime() + 400 * DAY) }, // after window
    { id: "e", externalId: null, startsAt: new Date(now.getTime() + 5 * DAY) }, // app-native
    { id: "f", externalId: "x6", startsAt: new Date(now.getTime() - 90 * DAY) }, // on the start edge
  ];
  const seen = new Set(["x1"]);

  it("only tombstones unseen rows inside the pulled window", () => {
    const window = deltaWindowFor(now);
    expect(staleLocalEventIds(existing, seen, window)).toEqual(["b", "f"]);
  });

  it("treats a missing window end as open-ended (Google full pull)", () => {
    const start = new Date(now.getTime() - 30 * DAY);
    expect(staleLocalEventIds(existing, seen, { start })).toEqual(["b", "d"]);
  });

  it("returns nothing when everything was returned", () => {
    const all = new Set(["x1", "x2", "x3", "x4", "x6"]);
    expect(staleLocalEventIds(existing, all, { start: new Date(0) })).toEqual([]);
  });
});

describe("advisoryLockAcquired", () => {
  it("reads postgres-js style row arrays", () => {
    expect(advisoryLockAcquired([{ locked: true }])).toBe(true);
    expect(advisoryLockAcquired([{ locked: false }])).toBe(false);
  });

  it("reads pglite style { rows } results", () => {
    expect(advisoryLockAcquired({ rows: [{ locked: true }] })).toBe(true);
    expect(advisoryLockAcquired({ rows: [{ locked: false }] })).toBe(false);
  });

  it("falls back to the raw function name and textual booleans", () => {
    expect(advisoryLockAcquired([{ pg_try_advisory_xact_lock: true }])).toBe(true);
    expect(advisoryLockAcquired([{ locked: "t" }])).toBe(true);
  });

  it("treats anything unexpected as not acquired", () => {
    expect(advisoryLockAcquired([])).toBe(false);
    expect(advisoryLockAcquired({ rows: [] })).toBe(false);
    expect(advisoryLockAcquired(undefined)).toBe(false);
    expect(advisoryLockAcquired(null)).toBe(false);
  });
});
