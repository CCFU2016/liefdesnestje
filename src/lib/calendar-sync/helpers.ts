import type { MsEvent } from "@/lib/microsoft/graph";

// Pure helpers for calendar sync. Kept free of DB / fetch imports so they can
// be unit-tested without booting PGlite. The tombstone + lock helpers are
// provider-neutral (google/sync.ts imports them too).

const DAY_MS = 24 * 60 * 60 * 1000;

/** calendarView/delta window used when minting a fresh Microsoft deltaLink. */
export const DELTA_LOOKBACK_MS = 90 * DAY_MS;
export const DELTA_LOOKAHEAD_MS = 365 * DAY_MS;

/**
 * How much future the stored delta window must still cover. Once the window's
 * end is closer than this, we drop the deltaLink so the next sync mints a new
 * one — otherwise events beyond the original +365d edge never arrive.
 */
export const DELTA_MIN_LOOKAHEAD_MS = 90 * DAY_MS;

export function deltaWindowFor(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(now.getTime() - DELTA_LOOKBACK_MS),
    end: new Date(now.getTime() + DELTA_LOOKAHEAD_MS),
  };
}

/**
 * Should we discard the stored deltaLink and request a fresh window?
 * `null` means the row predates window tracking (legacy) — reset once so the
 * window end gets recorded.
 */
export function shouldResetDeltaWindow(
  windowEnd: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!windowEnd) return true;
  return now.getTime() + DELTA_MIN_LOOKAHEAD_MS > windowEnd.getTime();
}

/**
 * Graph reports deletions as `@removed`; a meeting the organizer cancelled
 * stays in the attendee's calendar with `isCancelled: true` until they remove
 * it. Neither should show up in the household calendar.
 */
export function isRemovedMsEvent(e: Pick<MsEvent, "@removed" | "isCancelled">): boolean {
  return !!e["@removed"] || e.isCancelled === true;
}

/**
 * After a full (non-incremental) pull, local rows in the pulled window whose
 * externalId did not come back no longer exist upstream — return their ids so
 * the caller can soft-delete them. Rows outside the window were simply not
 * asked for, so they're left alone. Rows without an externalId are app-native
 * (or a failed push) and never tombstoned here.
 */
export function staleLocalEventIds(
  existing: ReadonlyArray<{ id: string; externalId: string | null; startsAt: Date }>,
  seenExternalIds: ReadonlySet<string>,
  window: { start: Date; end?: Date | null }
): string[] {
  const startMs = window.start.getTime();
  const endMs = window.end ? window.end.getTime() : Number.POSITIVE_INFINITY;
  return existing
    .filter((e) => {
      if (!e.externalId || seenExternalIds.has(e.externalId)) return false;
      const t = e.startsAt.getTime();
      return t >= startMs && t <= endMs;
    })
    .map((e) => e.id);
}

/**
 * Reads the boolean out of `SELECT pg_try_advisory_xact_lock(...) AS locked`.
 * drizzle's postgres-js driver returns the rows as an array; the pglite driver
 * wraps them in `{ rows }`. Anything unexpected counts as "not acquired" so a
 * driver change can't silently disable the guard.
 */
export function advisoryLockAcquired(result: unknown): boolean {
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] } | null | undefined)?.rows ?? []);
  const first = rows[0] as Record<string, unknown> | undefined;
  if (!first) return false;
  const v = first.locked ?? first.pg_try_advisory_xact_lock;
  return v === true || v === "t";
}
