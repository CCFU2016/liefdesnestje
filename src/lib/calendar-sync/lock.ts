import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { advisoryLockAcquired } from "@/lib/calendar-sync/helpers";

// Provider-neutral per-calendar sync lock (google/sync.ts uses it too).
//
// A webhook burst, the calendar page's POST /api/calendar-sync and the
// post-enable sync can all fire for the same calendar within seconds. Each
// sync reads the stored delta/sync token, pulls, then writes the next token —
// two of them interleaving can drop a token or double-insert. Cheap fix: only
// one sync per calendar at a time; the others just skip.

/**
 * In-process guard. On Postgres it saves a round-trip for the common case;
 * on PGlite it is the *only* guard — PGlite is a single connection, and any
 * `db.*` query issued from inside a `db.transaction` there deadlocks, so we
 * can't hold a transaction-scoped advisory lock around the sync body.
 */
const inFlight = new Set<string>();

function usesPglite(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return !url || url.startsWith("pglite://") || url === "pglite";
}

/**
 * Runs `fn` while holding a per-calendar lock. Returns `null` (without
 * running `fn`) when another sync for the same calendar is already running.
 *
 * On Postgres the lock is `pg_try_advisory_xact_lock(hashtext(id))` held on a
 * dedicated transaction for the duration of `fn`; `fn` itself keeps using the
 * pooled `db` handle, so nothing inside it is transactional — only the lock
 * is. That also makes it work across instances, not just this process.
 */
export async function withCalendarSyncLock<T>(
  calendarId: string,
  label: string,
  fn: () => Promise<T>
): Promise<T | null> {
  if (inFlight.has(calendarId)) {
    console.warn(`[${label}] sync already running for calendar ${calendarId}, skipping`);
    return null;
  }
  inFlight.add(calendarId);
  try {
    if (usesPglite()) return await fn();
    return await db.transaction(async (tx) => {
      const res = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${calendarId})) AS locked`
      );
      if (!advisoryLockAcquired(res)) {
        console.warn(`[${label}] sync already running for calendar ${calendarId}, skipping`);
        return null;
      }
      return await fn();
    });
  } finally {
    inFlight.delete(calendarId);
  }
}
