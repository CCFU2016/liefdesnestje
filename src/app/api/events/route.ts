import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { calendars, events, externalCalendarAccounts } from "@/lib/db/schema";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { createEvent as msCreateEvent } from "@/lib/microsoft/graph";
import { createEvent as gcalCreateEvent } from "@/lib/google/api";

const createSchema = z.object({
  calendarId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  allDay: z.boolean().optional(),
  location: z.string().optional(),
  timezone: z.string().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
});

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) return NextResponse.json({ error: "from,to required" }, { status: 400 });
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const rows = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.householdId, ctx.householdId),
          isNull(events.deletedAt),
          gte(events.endsAt, fromDate),
          lte(events.startsAt, toDate),
          or(eq(events.visibility, "shared"), eq(events.authorId, ctx.userId))
        )
      )
      .orderBy(events.startsAt);

    return NextResponse.json({ events: rows });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const cal = (
      await db.select().from(calendars).where(eq(calendars.id, body.data.calendarId)).limit(1)
    )[0];
    if (!cal) return NextResponse.json({ error: "Calendar not found" }, { status: 404 });

    const account = (
      await db
        .select()
        .from(externalCalendarAccounts)
        .where(eq(externalCalendarAccounts.id, cal.accountId))
        .limit(1)
    )[0];
    if (!account || account.userId !== ctx.userId) {
      return NextResponse.json({ error: "You can only add events to your own calendars" }, { status: 403 });
    }

    const startsAt = new Date(body.data.startsAt);
    const endsAt = new Date(body.data.endsAt);
    const timezone = body.data.timezone ?? "UTC";

    // Write through to the source provider first; if that fails, don't create locally.
    let externalId: string | null = null;
    let etag: string | null = null;

    if (account.provider === "microsoft") {
      const msEvent = await msCreateEvent(account.id, cal.externalId, {
        subject: body.data.title,
        body: body.data.description
          ? { contentType: "text", content: body.data.description }
          : undefined,
        start: { dateTime: startsAt.toISOString().replace("Z", ""), timeZone: "UTC" },
        end: { dateTime: endsAt.toISOString().replace("Z", ""), timeZone: "UTC" },
        isAllDay: !!body.data.allDay,
        location: body.data.location ? { displayName: body.data.location } : undefined,
      });
      externalId = msEvent.id;
      etag = msEvent["@odata.etag"] ?? null;
    } else if (account.provider === "google") {
      const gEvent = await gcalCreateEvent(account.id, cal.externalId, {
        summary: body.data.title,
        description: body.data.description,
        location: body.data.location,
        start: body.data.allDay
          ? { date: toDateOnly(startsAt) }
          : { dateTime: startsAt.toISOString() },
        end: body.data.allDay
          ? { date: toDateOnly(endsAt) }
          : { dateTime: endsAt.toISOString() },
      });
      externalId = gEvent.id;
      etag = gEvent.etag ?? null;
    }

    const [local] = await db
      .insert(events)
      .values({
        householdId: ctx.householdId,
        calendarId: cal.id,
        authorId: ctx.userId,
        title: body.data.title,
        description: body.data.description,
        startsAt,
        endsAt,
        allDay: !!body.data.allDay,
        location: body.data.location,
        timezone,
        visibility: body.data.visibility ?? "shared",
        externalId,
        etag,
      })
      .returning();

    return NextResponse.json({ event: local });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("create event failed", e);
    return NextResponse.json({ error: "Could not save to your calendar. Try again." }, { status: 500 });
  }
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
