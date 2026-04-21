import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { calendars, events, externalCalendarAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { deleteEvent as msDeleteEvent, updateEvent as msUpdateEvent } from "@/lib/microsoft/graph";
import { deleteEvent as gcalDeleteEvent, updateEvent as gcalUpdateEvent } from "@/lib/google/api";

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  location: z.string().nullable().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
});

async function loadEventForCaller(
  id: string,
  ctx: Awaited<ReturnType<typeof requireHouseholdMember>>
) {
  const ev = (await db.select().from(events).where(eq(events.id, id)).limit(1))[0];
  if (!ev) return null;
  if (ev.householdId !== ctx.householdId) return null;
  if (ev.visibility === "private" && ev.authorId !== ctx.userId) return null;
  if (ev.deletedAt) return null;
  return ev;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const ev = await loadEventForCaller(id, ctx);
    if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // If it has an external source, write-through to that provider first.
    if (ev.calendarId && ev.externalId) {
      const cal = (await db.select().from(calendars).where(eq(calendars.id, ev.calendarId)).limit(1))[0];
      if (cal && cal.sourceType === "ics") {
        return NextResponse.json(
          { error: "Can't edit — this calendar is read-only (ICS subscription)." },
          { status: 400 }
        );
      }
      if (cal && cal.accountId) {
        const account = (
          await db.select().from(externalCalendarAccounts).where(eq(externalCalendarAccounts.id, cal.accountId)).limit(1)
        )[0];
        if (account && account.userId === ctx.userId) {
          const startsAt = body.data.startsAt ? new Date(body.data.startsAt) : ev.startsAt;
          const endsAt = body.data.endsAt ? new Date(body.data.endsAt) : ev.endsAt;
          let newEtag: string | null = ev.etag;

          if (account.provider === "microsoft") {
            const result = await msUpdateEvent(
              account.id,
              ev.externalId,
              {
                ...(body.data.title !== undefined ? { subject: body.data.title } : {}),
                ...(body.data.description !== undefined
                  ? { body: { contentType: "text", content: body.data.description ?? "" } }
                  : {}),
                ...(body.data.startsAt
                  ? { start: { dateTime: startsAt.toISOString().replace("Z", ""), timeZone: "UTC" } }
                  : {}),
                ...(body.data.endsAt
                  ? { end: { dateTime: endsAt.toISOString().replace("Z", ""), timeZone: "UTC" } }
                  : {}),
                ...(body.data.allDay !== undefined ? { isAllDay: body.data.allDay } : {}),
                ...(body.data.location !== undefined
                  ? { location: { displayName: body.data.location ?? "" } }
                  : {}),
              },
              ev.etag ?? null
            );
            newEtag = result["@odata.etag"] ?? ev.etag;
          } else if (account.provider === "google") {
            const allDay = body.data.allDay ?? ev.allDay;
            const result = await gcalUpdateEvent(
              account.id,
              cal.externalId,
              ev.externalId,
              {
                ...(body.data.title !== undefined ? { summary: body.data.title } : {}),
                ...(body.data.description !== undefined ? { description: body.data.description ?? "" } : {}),
                ...(body.data.startsAt
                  ? {
                      start: allDay
                        ? { date: startsAt.toISOString().slice(0, 10) }
                        : { dateTime: startsAt.toISOString() },
                    }
                  : {}),
                ...(body.data.endsAt
                  ? {
                      end: allDay
                        ? { date: endsAt.toISOString().slice(0, 10) }
                        : { dateTime: endsAt.toISOString() },
                    }
                  : {}),
                ...(body.data.location !== undefined ? { location: body.data.location ?? "" } : {}),
              },
              ev.etag ?? null
            );
            newEtag = result.etag ?? ev.etag;
          }

          const [local] = await db
            .update(events)
            .set({
              title: body.data.title ?? ev.title,
              description: body.data.description !== undefined ? body.data.description : ev.description,
              startsAt,
              endsAt,
              allDay: body.data.allDay ?? ev.allDay,
              location: body.data.location !== undefined ? body.data.location : ev.location,
              visibility: body.data.visibility ?? ev.visibility,
              etag: newEtag,
              updatedAt: new Date(),
            })
            .where(eq(events.id, id))
            .returning();
          return NextResponse.json({ event: local });
        }
      }
    }

    // App-native (no external): just update locally.
    const [local] = await db
      .update(events)
      .set({
        title: body.data.title ?? ev.title,
        description: body.data.description !== undefined ? body.data.description : ev.description,
        startsAt: body.data.startsAt ? new Date(body.data.startsAt) : ev.startsAt,
        endsAt: body.data.endsAt ? new Date(body.data.endsAt) : ev.endsAt,
        allDay: body.data.allDay ?? ev.allDay,
        location: body.data.location !== undefined ? body.data.location : ev.location,
        visibility: body.data.visibility ?? ev.visibility,
        updatedAt: new Date(),
      })
      .where(eq(events.id, id))
      .returning();
    return NextResponse.json({ event: local });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("patch event failed", e);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;

    const ev = await loadEventForCaller(id, ctx);
    if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (ev.calendarId && ev.externalId) {
      const cal = (await db.select().from(calendars).where(eq(calendars.id, ev.calendarId)).limit(1))[0];
      if (cal && cal.sourceType === "ics") {
        return NextResponse.json(
          { error: "Can't delete — this calendar is read-only (ICS subscription)." },
          { status: 400 }
        );
      }
      if (cal && cal.accountId) {
        const account = (
          await db.select().from(externalCalendarAccounts).where(eq(externalCalendarAccounts.id, cal.accountId)).limit(1)
        )[0];
        if (account && account.userId === ctx.userId) {
          try {
            if (account.provider === "microsoft") {
              await msDeleteEvent(account.id, ev.externalId);
            } else if (account.provider === "google") {
              await gcalDeleteEvent(account.id, cal.externalId, ev.externalId);
            }
          } catch (e) {
            console.warn("remote delete failed, continuing to local delete", e);
          }
        }
      }
    }

    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("delete event failed", e);
    return NextResponse.json({ error: "Could not delete. Try again." }, { status: 500 });
  }
}
