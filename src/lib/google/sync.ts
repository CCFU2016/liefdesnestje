import { db } from "@/lib/db";
import { calendars, events, externalCalendarAccounts } from "@/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  listCalendars,
  listEventsDelta,
  stopChannel,
  watchEvents,
  type GcalEvent,
  type GcalDateTime,
} from "./api";
import { requireEnv } from "@/lib/env";
import { randomToken } from "@/lib/utils";
import { staleLocalEventIds } from "@/lib/calendar-sync/helpers";
import { withCalendarSyncLock } from "@/lib/calendar-sync/lock";

export async function syncCalendarList(accountId: string): Promise<string[]> {
  const items = await listCalendars(accountId);
  const existing = await db.select().from(calendars).where(eq(calendars.accountId, accountId));
  const existingByExt = new Map(existing.map((c) => [c.externalId, c]));

  const newIds: string[] = [];
  for (const item of items) {
    if (existingByExt.has(item.id)) continue;
    const [inserted] = await db
      .insert(calendars)
      .values({
        accountId,
        externalId: item.id,
        name: item.summaryOverride ?? item.summary,
        color:
          item.backgroundColor && /^#[0-9a-fA-F]{6}$/.test(item.backgroundColor)
            ? item.backgroundColor
            : "#059669",
        syncEnabled: !!item.primary,
      })
      .returning();
    newIds.push(inserted.id);
  }
  return newIds;
}

/**
 * Pull (delta) events for one calendar and upsert them locally. Records the
 * outcome on the calendar row (lastSyncedAt / lastError) so Settings can
 * surface failures, and rethrows so callers can still log. Skips (returning
 * zeros) if another sync for the same calendar is already running.
 */
export async function syncCalendarEvents(
  accountId: string,
  localCalendarId: string,
  householdId: string,
  authorId: string
): Promise<{ upserted: number; removed: number }> {
  const result = await withCalendarSyncLock(localCalendarId, "google", () =>
    syncCalendarEventsLocked(accountId, localCalendarId, householdId, authorId)
  );
  return result ?? { upserted: 0, removed: 0 };
}

async function syncCalendarEventsLocked(
  accountId: string,
  localCalendarId: string,
  householdId: string,
  authorId: string
): Promise<{ upserted: number; removed: number }> {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, localCalendarId)).limit(1))[0];
  if (!cal) throw new Error("Calendar not found");

  try {
    let result = await listEventsDelta(accountId, cal.externalId, cal.syncToken ?? null);

    // If the stored syncToken was invalidated, retry with no token (full pull)
    if (result.syncTokenInvalidated) {
      await db.update(calendars).set({ syncToken: null }).where(eq(calendars.id, localCalendarId));
      result = await listEventsDelta(accountId, cal.externalId, null);
    }

    let upserted = 0;
    let removed = 0;
    const seen = new Set<string>();
    for (const e of result.events) {
      if (e.status === "cancelled") {
        await db
          .update(events)
          .set({ deletedAt: new Date() })
          .where(and(eq(events.calendarId, localCalendarId), eq(events.externalId, e.id)));
        removed++;
        continue;
      }
      const mapped = mapGcalToLocal(e);
      if (!mapped) continue;
      seen.add(e.id);

      // Upsert key is (calendarId, externalId) — a full re-pull therefore
      // updates existing rows in place and can't duplicate them.
      const existing = (
        await db
          .select()
          .from(events)
          .where(and(eq(events.calendarId, localCalendarId), eq(events.externalId, e.id)))
          .limit(1)
      )[0];

      if (existing) {
        await db
          .update(events)
          .set({
            title: mapped.title,
            description: mapped.description,
            startsAt: mapped.startsAt,
            endsAt: mapped.endsAt,
            allDay: mapped.allDay,
            location: mapped.location,
            timezone: mapped.timezone,
            organizerName: mapped.organizerName,
            organizerEmail: mapped.organizerEmail,
            etag: e.etag ?? null,
            updatedAt: new Date(),
            deletedAt: null,
          })
          .where(eq(events.id, existing.id));
      } else {
        await db.insert(events).values({
          householdId,
          calendarId: localCalendarId,
          authorId,
          title: mapped.title,
          description: mapped.description,
          startsAt: mapped.startsAt,
          endsAt: mapped.endsAt,
          allDay: mapped.allDay,
          location: mapped.location,
          timezone: mapped.timezone,
          organizerName: mapped.organizerName,
          organizerEmail: mapped.organizerEmail,
          externalId: e.id,
          etag: e.etag ?? null,
          visibility: "shared",
        });
      }
      upserted++;
    }

    if (result.windowStart) {
      // Full (non-incremental) pull: local rows from the pulled window that
      // Google didn't return were deleted upstream while we had no valid
      // syncToken — tombstone them, like ics/sync.ts does.
      const existing = await db
        .select({ id: events.id, externalId: events.externalId, startsAt: events.startsAt })
        .from(events)
        .where(and(eq(events.calendarId, localCalendarId), isNull(events.deletedAt)));
      const stale = staleLocalEventIds(existing, seen, { start: result.windowStart });
      if (stale.length > 0) {
        await db.update(events).set({ deletedAt: new Date() }).where(inArray(events.id, stale));
        removed += stale.length;
      }
    }

    await db
      .update(calendars)
      .set({
        ...(result.nextSyncToken ? { syncToken: result.nextSyncToken } : {}),
        lastSyncedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(calendars.id, localCalendarId));

    return { upserted, removed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(calendars)
      .set({ lastError: msg, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(calendars.id, localCalendarId));
    throw e;
  }
}

function mapGcalToLocal(e: GcalEvent) {
  if (!e.start || !e.end) return null;
  const { startsAt, endsAt, allDay, timezone } = extractRange(e.start, e.end);
  return {
    title: e.summary ?? "(No title)",
    description: e.description ?? null,
    startsAt,
    endsAt,
    allDay,
    location: e.location ?? null,
    timezone,
    organizerName: e.organizer?.displayName ?? null,
    organizerEmail: e.organizer?.email ?? null,
  };
}

function extractRange(start: GcalDateTime, end: GcalDateTime) {
  if ("date" in start && "date" in end) {
    // all-day
    return {
      startsAt: new Date(`${start.date}T00:00:00Z`),
      endsAt: new Date(`${end.date}T00:00:00Z`),
      allDay: true,
      timezone: "UTC",
    };
  }
  const s = start as { dateTime: string; timeZone?: string };
  const e = end as { dateTime: string; timeZone?: string };
  return {
    startsAt: new Date(s.dateTime),
    endsAt: new Date(e.dateTime),
    allDay: false,
    timezone: s.timeZone ?? "UTC",
  };
}

/**
 * Create a watch channel for a calendar. Stores channel id + resourceId +
 * expiration. Call `unsubscribeCalendar` before replacing an existing channel.
 */
export async function subscribeCalendar(
  accountId: string,
  localCalendarId: string
): Promise<void> {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, localCalendarId)).limit(1))[0];
  if (!cal) throw new Error("Calendar not found");
  const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");
  const token = requireEnv("WEBHOOK_SECRET");
  const address = `${appUrl}/api/integrations/google/webhook`;
  const channelId = `lnest-${localCalendarId}-${randomToken(6)}`;

  if (cal.subscriptionId && cal.subscriptionResourceId) {
    try {
      await stopChannel(accountId, cal.subscriptionId, cal.subscriptionResourceId);
    } catch {
      // best-effort — Google may have expired it already
    }
  }

  const ch = await watchEvents(accountId, cal.externalId, {
    channelId,
    address,
    token,
    ttlSeconds: 7 * 24 * 60 * 60, // 7 days (max)
  });

  const expiresAt = ch.expiration ? new Date(parseInt(ch.expiration, 10)) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db
    .update(calendars)
    .set({
      subscriptionId: ch.id,
      subscriptionResourceId: ch.resourceId,
      subscriptionExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(calendars.id, localCalendarId));
}

export async function unsubscribeCalendar(
  accountId: string,
  localCalendarId: string
): Promise<void> {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, localCalendarId)).limit(1))[0];
  if (!cal || !cal.subscriptionId || !cal.subscriptionResourceId) return;
  try {
    await stopChannel(accountId, cal.subscriptionId, cal.subscriptionResourceId);
  } finally {
    await db
      .update(calendars)
      .set({ subscriptionId: null, subscriptionResourceId: null, subscriptionExpiresAt: null })
      .where(eq(calendars.id, localCalendarId));
  }
}

export async function accountForCalendar(localCalendarId: string) {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, localCalendarId)).limit(1))[0];
  if (!cal || !cal.accountId) return null;
  const account = (
    await db
      .select()
      .from(externalCalendarAccounts)
      .where(eq(externalCalendarAccounts.id, cal.accountId))
      .limit(1)
  )[0];
  if (!account) return null;
  return { calendar: cal, account };
}
