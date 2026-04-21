import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createEvent as msCreate, deleteEvent as msDelete, updateEvent as msUpdate } from "@/lib/microsoft/graph";
import {
  createEvent as gcalCreate,
  deleteEvent as gcalDelete,
  updateEvent as gcalUpdate,
} from "@/lib/google/api";

/**
 * Creates an all-day event on the user's primary calendar of the given
 * provider. Returns the external event ID on success. Does not create if
 * the user has no matching account or primary calendar.
 */
export async function pushHolidayToCalendar(input: {
  userId: string;
  provider: "google" | "microsoft";
  title: string;
  description: string | null;
  startsOn: string; // YYYY-MM-DD
  endsOn: string | null;
}): Promise<{ externalEventId: string; calendarId: string } | null> {
  const account = (
    await db
      .select()
      .from(externalCalendarAccounts)
      .where(
        and(
          eq(externalCalendarAccounts.userId, input.userId),
          eq(externalCalendarAccounts.provider, input.provider)
        )
      )
      .limit(1)
  )[0];
  if (!account) return null;

  // Primary = first calendar with syncEnabled=true, or just the first one.
  const primary = (
    await db
      .select()
      .from(calendars)
      .where(eq(calendars.accountId, account.id))
      .orderBy(calendars.syncEnabled)
      .limit(1)
  )[0];
  if (!primary) return null;

  const endExclusive = input.endsOn ? addDays(input.endsOn, 1) : addDays(input.startsOn, 1);

  if (input.provider === "microsoft") {
    const ev = await msCreate(account.id, primary.externalId, {
      subject: input.title,
      body: input.description
        ? { contentType: "text", content: input.description }
        : undefined,
      start: { dateTime: `${input.startsOn}T00:00:00`, timeZone: "UTC" },
      end: { dateTime: `${endExclusive}T00:00:00`, timeZone: "UTC" },
      isAllDay: true,
    });
    return { externalEventId: ev.id, calendarId: primary.id };
  } else {
    const ev = await gcalCreate(account.id, primary.externalId, {
      summary: input.title,
      description: input.description ?? undefined,
      start: { date: input.startsOn },
      end: { date: endExclusive },
    });
    return { externalEventId: ev.id, calendarId: primary.id };
  }
}

export async function updatePushedHoliday(input: {
  userId: string;
  provider: "google" | "microsoft";
  externalEventId: string;
  localCalendarId: string;
  title: string;
  description: string | null;
  startsOn: string;
  endsOn: string | null;
}): Promise<void> {
  const account = (
    await db
      .select()
      .from(externalCalendarAccounts)
      .where(
        and(
          eq(externalCalendarAccounts.userId, input.userId),
          eq(externalCalendarAccounts.provider, input.provider)
        )
      )
      .limit(1)
  )[0];
  if (!account) return;

  const cal = (
    await db.select().from(calendars).where(eq(calendars.id, input.localCalendarId)).limit(1)
  )[0];
  if (!cal || !cal.externalId) return;

  const endExclusive = input.endsOn ? addDays(input.endsOn, 1) : addDays(input.startsOn, 1);

  if (input.provider === "microsoft") {
    await msUpdate(account.id, input.externalEventId, {
      subject: input.title,
      body: input.description
        ? { contentType: "text", content: input.description }
        : undefined,
      start: { dateTime: `${input.startsOn}T00:00:00`, timeZone: "UTC" },
      end: { dateTime: `${endExclusive}T00:00:00`, timeZone: "UTC" },
      isAllDay: true,
    });
  } else {
    await gcalUpdate(account.id, cal.externalId, input.externalEventId, {
      summary: input.title,
      description: input.description ?? undefined,
      start: { date: input.startsOn },
      end: { date: endExclusive },
    });
  }
}

export async function deletePushedHoliday(input: {
  userId: string;
  provider: "google" | "microsoft";
  externalEventId: string;
  localCalendarId: string;
}): Promise<void> {
  const account = (
    await db
      .select()
      .from(externalCalendarAccounts)
      .where(
        and(
          eq(externalCalendarAccounts.userId, input.userId),
          eq(externalCalendarAccounts.provider, input.provider)
        )
      )
      .limit(1)
  )[0];
  if (!account) return;

  const cal = (
    await db.select().from(calendars).where(eq(calendars.id, input.localCalendarId)).limit(1)
  )[0];
  if (!cal) return;

  if (input.provider === "microsoft") {
    await msDelete(account.id, input.externalEventId);
  } else {
    await gcalDelete(account.id, cal.externalId, input.externalEventId);
  }
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
