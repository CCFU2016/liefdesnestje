import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { holidays, householdMembers } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  deletePushedHoliday,
  pushHolidayToCalendar,
  updatePushedHoliday,
} from "@/lib/calendar-push";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  forPersons: z.array(z.string().uuid()).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  pushToCalendar: z.boolean().optional(),
  pushProvider: z.enum(["google", "microsoft"]).nullable().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  hasTravel: z.boolean().optional(),
});

async function loadForCaller(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const h = (await db.select().from(holidays).where(eq(holidays.id, id)).limit(1))[0];
  if (!h) return null;
  if (h.householdId !== ctx.householdId) return null;
  if (h.visibility === "private" && h.authorId !== ctx.userId) return null;
  if (h.deletedAt) return null;
  return h;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const h = await loadForCaller(id, ctx);
    if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ holiday: h });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const h = await loadForCaller(id, ctx);
    if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (h.authorId !== ctx.userId) {
      return NextResponse.json({ error: "Only the holiday's author can edit." }, { status: 403 });
    }

    if (body.data.forPersons) {
      const valid = await db
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, ctx.householdId),
            inArray(householdMembers.userId, body.data.forPersons)
          )
        );
      if (valid.length !== body.data.forPersons.length) {
        return NextResponse.json(
          { error: "forPersons must be members of this household." },
          { status: 400 }
        );
      }
    }

    const update: Partial<typeof holidays.$inferInsert> = { updatedAt: new Date() };
    if (body.data.title !== undefined) update.title = body.data.title;
    if (body.data.description !== undefined) update.description = body.data.description;
    if (body.data.startsOn !== undefined) update.startsOn = body.data.startsOn;
    if (body.data.endsOn !== undefined) update.endsOn = body.data.endsOn;
    if (body.data.forPersons !== undefined) update.forPersons = body.data.forPersons;
    if (body.data.categoryId !== undefined) update.categoryId = body.data.categoryId;
    if (body.data.visibility !== undefined) update.visibility = body.data.visibility;
    if (body.data.pushToCalendar !== undefined) update.pushToCalendar = body.data.pushToCalendar;
    if (body.data.hasTravel !== undefined) update.hasTravel = body.data.hasTravel;

    const newStartsOn = body.data.startsOn ?? h.startsOn;
    const newEndsOn = body.data.endsOn !== undefined ? body.data.endsOn : h.endsOn;
    const newTitle = body.data.title ?? h.title;
    const newDescription = body.data.description !== undefined ? body.data.description : h.description;

    let warning: string | null = null;
    const wasPushed = h.pushToCalendar && h.externalCalendarEventId && h.externalCalendarProvider && h.externalCalendarId;
    const willPush = body.data.pushToCalendar ?? h.pushToCalendar;

    try {
      if (wasPushed && !willPush) {
        // Toggle OFF: delete the pushed event
        await deletePushedHoliday({
          userId: h.authorId,
          provider: h.externalCalendarProvider!,
          externalEventId: h.externalCalendarEventId!,
          localCalendarId: h.externalCalendarId!,
        });
        update.externalCalendarEventId = null;
        update.externalCalendarProvider = null;
        update.externalCalendarId = null;
      } else if (wasPushed && willPush) {
        // Update the remote event
        await updatePushedHoliday({
          userId: h.authorId,
          provider: h.externalCalendarProvider!,
          externalEventId: h.externalCalendarEventId!,
          localCalendarId: h.externalCalendarId!,
          title: newTitle,
          description: newDescription,
          startsOn: newStartsOn,
          endsOn: newEndsOn,
        });
      } else if (!wasPushed && willPush) {
        // Toggle ON: create a new remote event
        const provider = body.data.pushProvider ?? "google";
        const pushed = await pushHolidayToCalendar({
          userId: h.authorId,
          provider,
          title: newTitle,
          description: newDescription,
          startsOn: newStartsOn,
          endsOn: newEndsOn,
        });
        if (pushed) {
          update.externalCalendarEventId = pushed.externalEventId;
          update.externalCalendarProvider = provider;
          update.externalCalendarId = pushed.calendarId;
        } else {
          warning = "Saved locally, but no calendar is connected to push to — connect one in Settings.";
        }
      }
    } catch (e) {
      console.error("push-to-calendar update failed", e);
      warning = "Saved locally, calendar sync failed — try again from the holiday page.";
    }

    const [updated] = await db.update(holidays).set(update).where(eq(holidays.id, id)).returning();
    return NextResponse.json({ holiday: updated, warning });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const h = await loadForCaller(id, ctx);
    if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (h.authorId !== ctx.userId) {
      return NextResponse.json({ error: "Only the author can delete." }, { status: 403 });
    }

    // Best-effort: delete the pushed calendar event
    if (h.externalCalendarEventId && h.externalCalendarProvider && h.externalCalendarId) {
      try {
        await deletePushedHoliday({
          userId: h.authorId,
          provider: h.externalCalendarProvider,
          externalEventId: h.externalCalendarEventId,
          localCalendarId: h.externalCalendarId,
        });
      } catch (e) {
        console.warn("couldn't delete pushed event, continuing with local delete", e);
      }
    }

    await db.update(holidays).set({ deletedAt: new Date() }).where(eq(holidays.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
