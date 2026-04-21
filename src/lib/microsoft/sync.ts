import { db } from "@/lib/db";
import { calendars, events, externalCalendarAccounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  createSubscription,
  deltaEvents,
  listCalendars,
  type MsEvent,
} from "./graph";
import { requireEnv } from "@/lib/env";

/**
 * Pull (or refresh) the list of calendars for the given account. Inserts
 * new ones with sync enabled. Does not delete calendars that are gone —
 * those are handled via sync, not list.
 */
export async function syncCalendarList(accountId: string): Promise<string[]> {
  const msCals = await listCalendars(accountId);
  const existing = await db.select().from(calendars).where(eq(calendars.accountId, accountId));
  const existingByExt = new Map(existing.map((c) => [c.externalId, c]));

  const newIds: string[] = [];
  for (const mc of msCals) {
    const prev = existingByExt.get(mc.id);
    if (!prev) {
      const [inserted] = await db
        .insert(calendars)
        .values({
          accountId,
          externalId: mc.id,
          name: mc.name,
          color: mc.hexColor && /^#[0-9a-fA-F]{6}$/.test(mc.hexColor) ? mc.hexColor : "#4f46e5",
          syncEnabled: !!mc.isDefaultCalendar, // default: only sync the primary; user can enable others later
        })
        .returning();
      newIds.push(inserted.id);
    }
  }
  return newIds;
}

/**
 * Pull delta events for one calendar and upsert into the local events table.
 * Uses last stored deltaLink when present.
 */
export async function syncCalendarEvents(
  accountId: string,
  localCalendarId: string,
  householdId: string,
  authorId: string
): Promise<{ upserted: number; removed: number }> {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, localCalendarId)).limit(1))[0];
  if (!cal) throw new Error("Calendar not found");

  const { value, nextDeltaLink } = await deltaEvents(accountId, cal.externalId, cal.deltaLink ?? null);

  let upserted = 0;
  let removed = 0;

  for (const e of value) {
    if (e["@removed"]) {
      await db
        .update(events)
        .set({ deletedAt: new Date() })
        .where(and(eq(events.calendarId, localCalendarId), eq(events.externalId, e.id)));
      removed++;
      continue;
    }
    const mapped = mapMsToLocal(e);
    if (!mapped) continue;

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
          etag: e["@odata.etag"] ?? null,
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
        externalId: e.id,
        etag: e["@odata.etag"] ?? null,
        visibility: "shared",
      });
    }
    upserted++;
  }

  await db
    .update(calendars)
    .set({ deltaLink: nextDeltaLink, updatedAt: new Date() })
    .where(eq(calendars.id, localCalendarId));

  return { upserted, removed };
}

function mapMsToLocal(e: MsEvent) {
  if (!e.start || !e.end) return null;
  return {
    title: e.subject ?? "(No title)",
    description: e.body?.content ?? e.bodyPreview ?? null,
    startsAt: new Date(e.start.dateTime + "Z"), // Graph datetimes lack Z
    endsAt: new Date(e.end.dateTime + "Z"),
    allDay: !!e.isAllDay,
    location: e.location?.displayName ?? null,
    timezone: e.start.timeZone ?? "UTC",
  };
}

/**
 * Create a webhook subscription for a calendar. Requires the calendar's
 * externalId. Updates the local `calendars` row with subscription info.
 */
export async function subscribeCalendar(
  accountId: string,
  localCalendarId: string
): Promise<void> {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, localCalendarId)).limit(1))[0];
  if (!cal) throw new Error("Calendar not found");
  const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");
  const clientState = requireEnv("WEBHOOK_SECRET");
  const notificationUrl = `${appUrl}/api/integrations/microsoft/webhook`;

  const sub = await createSubscription(accountId, cal.externalId, {
    notificationUrl,
    clientState,
  });

  await db
    .update(calendars)
    .set({
      subscriptionId: sub.id,
      subscriptionExpiresAt: new Date(sub.expirationDateTime),
      updatedAt: new Date(),
    })
    .where(eq(calendars.id, localCalendarId));
}

/** Returns the account row owning a local calendar (for downstream API calls). */
export async function accountForCalendar(localCalendarId: string) {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, localCalendarId)).limit(1))[0];
  if (!cal || !cal.accountId) return null;
  const account = (
    await db.select().from(externalCalendarAccounts).where(eq(externalCalendarAccounts.id, cal.accountId)).limit(1)
  )[0];
  if (!account) return null;
  return { calendar: cal, account };
}
