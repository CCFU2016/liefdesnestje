import ical from "node-ical";
import { db } from "@/lib/db";
import { calendars, events } from "@/lib/db/schema";
import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { requireEnv as _requireEnv } from "@/lib/env";
import { RRule } from "rrule";

void _requireEnv; // reserved for future use

/**
 * Fetch + parse + upsert events for a single ICS subscription. Removes any
 * events no longer in the feed (tombstones).
 *
 * Resilient to transient HTTP failures: stores last_error so the user can see
 * a problem surfaced in Settings.
 */
export async function refreshIcsCalendar(calendarId: string): Promise<{
  upserted: number;
  removed: number;
}> {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, calendarId)).limit(1))[0];
  if (!cal) throw new Error("ICS calendar not found");
  if (cal.sourceType !== "ics" || !cal.icsUrl) throw new Error("Not an ICS calendar");
  if (!cal.householdId) throw new Error("ICS calendar missing householdId");

  try {
    // Use a browser-like UA — some ICS hosts (e.g., Outlook.com published
    // feeds, private Google CalDAV endpoints) reject unknown user-agents
    // with a 403 / 500.
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Liefdesnestje/1.0",
      Accept: "text/calendar, text/plain, */*",
    };
    if (cal.icsEtag) headers["If-None-Match"] = cal.icsEtag;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(cal.icsUrl, { headers, redirect: "follow", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 304) {
      // unchanged
      await db
        .update(calendars)
        .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(calendars.id, calendarId));
      return { upserted: 0, removed: 0 };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const firstLine = body.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? "";
      throw new Error(
        `The feed returned ${res.status} ${res.statusText || ""}${firstLine ? ` — ${firstLine}` : ""}`.trim()
      );
    }

    const etag = res.headers.get("etag");
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      throw new Error("Response doesn't look like ICS (no BEGIN:VCALENDAR)");
    }

    const parsed = ical.sync.parseICS(text);

    // Build the set of current UIDs + their materialized occurrences.
    // For recurring events, expand into the [-90d, +365d] window.
    const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const incoming: Array<{
      externalId: string; // either UID or UID:occurrence
      title: string;
      description: string | null;
      startsAt: Date;
      endsAt: Date;
      allDay: boolean;
      location: string | null;
      timezone: string;
    }> = [];

    for (const key of Object.keys(parsed)) {
      const entry = parsed[key];
      if (!entry || entry.type !== "VEVENT") continue;
      const vevent = entry as ical.VEvent;
      if (!vevent.start || !vevent.end) continue;
      if ((vevent.status as string | undefined) === "CANCELLED") continue;

      const uid = vevent.uid ?? key;
      const title = (vevent.summary as string | undefined) ?? "(No title)";
      const description = (vevent.description as string | undefined) ?? null;
      const location = (vevent.location as string | undefined) ?? null;
      const allDay = isAllDay(vevent.start, vevent.end);
      const timezone =
        ((vevent.start as Date & { tz?: string }).tz as string | undefined) ?? "UTC";

      if (vevent.rrule) {
        // Recurring master: expand occurrences within the window.
        const rule = vevent.rrule as unknown as RRule;
        const occurrences = rule.between(windowStart, windowEnd, true);
        const durationMs =
          (vevent.end as Date).getTime() - (vevent.start as Date).getTime();
        for (const occ of occurrences) {
          // Skip exceptions (EXDATE)
          if (vevent.exdate && Object.keys(vevent.exdate).some((ex) => sameLocalDate(new Date(ex), occ))) {
            continue;
          }
          incoming.push({
            externalId: `${uid}:${occ.toISOString()}`,
            title,
            description,
            startsAt: occ,
            endsAt: new Date(occ.getTime() + durationMs),
            allDay,
            location,
            timezone,
          });
        }
      } else {
        const start = vevent.start as Date;
        const end = vevent.end as Date;
        // Skip single events outside the window.
        if (end < windowStart || start > windowEnd) continue;
        incoming.push({
          externalId: uid,
          title,
          description,
          startsAt: start,
          endsAt: end,
          allDay,
          location,
          timezone,
        });
      }
    }

    // Upsert: find existing events for this calendar, diff by externalId.
    const existing = await db
      .select({ id: events.id, externalId: events.externalId })
      .from(events)
      .where(and(eq(events.calendarId, calendarId), isNull(events.deletedAt)));

    const existingByExt = new Map(existing.map((e) => [e.externalId!, e.id]));
    const incomingIds = new Set(incoming.map((e) => e.externalId));

    let upserted = 0;
    for (const ev of incoming) {
      const existingId = existingByExt.get(ev.externalId);
      if (existingId) {
        await db
          .update(events)
          .set({
            title: ev.title,
            description: ev.description,
            startsAt: ev.startsAt,
            endsAt: ev.endsAt,
            allDay: ev.allDay,
            location: ev.location,
            timezone: ev.timezone,
            updatedAt: new Date(),
            deletedAt: null,
          })
          .where(eq(events.id, existingId));
      } else {
        await db.insert(events).values({
          householdId: cal.householdId!,
          calendarId: calendarId,
          authorId: await getFirstMemberUserId(cal.householdId!),
          title: ev.title,
          description: ev.description,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          allDay: ev.allDay,
          location: ev.location,
          timezone: ev.timezone,
          externalId: ev.externalId,
          visibility: "shared",
        });
      }
      upserted++;
    }

    // Tombstone: anything we had before but is no longer in the feed.
    const toRemove = existing.filter((e) => e.externalId && !incomingIds.has(e.externalId));
    let removed = 0;
    if (toRemove.length > 0) {
      await db
        .update(events)
        .set({ deletedAt: new Date() })
        .where(inArray(events.id, toRemove.map((e) => e.id)));
      removed = toRemove.length;
    }

    await db
      .update(calendars)
      .set({
        lastSyncedAt: new Date(),
        lastError: null,
        icsEtag: etag ?? cal.icsEtag,
        updatedAt: new Date(),
      })
      .where(eq(calendars.id, calendarId));

    return { upserted, removed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(calendars)
      .set({ lastError: msg, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(calendars.id, calendarId));
    throw e;
  }
}

function isAllDay(start: unknown, end: unknown): boolean {
  const s = start as { dateOnly?: boolean } & Date;
  if (s.dateOnly === true) return true;
  if (!(start instanceof Date) || !(end instanceof Date)) return false;
  const h = start.getUTCHours();
  const m = start.getUTCMinutes();
  const dur = end.getTime() - start.getTime();
  return h === 0 && m === 0 && dur % (24 * 60 * 60 * 1000) === 0 && dur >= 24 * 60 * 60 * 1000;
}

function sameLocalDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

async function getFirstMemberUserId(householdId: string): Promise<string> {
  const { householdMembers } = await import("@/lib/db/schema");
  const row = (
    await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId)).limit(1)
  )[0];
  if (!row) throw new Error("Household has no members");
  return row.userId;
}

/** Refresh all ICS calendars older than `staleAfterMs`, household-wide or across all. */
export async function refreshStaleIcs(staleAfterMs: number = 4 * 60 * 60 * 1000): Promise<{
  refreshed: number;
  failed: number;
}> {
  const threshold = new Date(Date.now() - staleAfterMs);
  const stale = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.sourceType, "ics"), eq(calendars.syncEnabled, true)));

  let refreshed = 0;
  let failed = 0;
  for (const c of stale) {
    if (c.lastSyncedAt && c.lastSyncedAt > threshold) continue;
    try {
      await refreshIcsCalendar(c.id);
      refreshed++;
    } catch (e) {
      console.error("ICS refresh failed for", c.name, e);
      failed++;
    }
  }
  return { refreshed, failed };
}

// keep unused imports type-checked
void ne; void notInArray;
