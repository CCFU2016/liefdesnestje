import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { externalCalendarAccounts, holidays, householdMembers } from "@/lib/db/schema";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { pushHolidayToCalendar } from "@/lib/calendar-push";
import { ensureDefaultCategories } from "@/lib/event-categories";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  forPersons: z.array(z.string().uuid()).default([]),
  categoryId: z.string().uuid().nullable().optional(),
  pushToCalendar: z.boolean().default(false),
  pushProvider: z.enum(["google", "microsoft"]).nullable().optional(),
  visibility: z.enum(["private", "shared"]).default("shared"),
});

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    await ensureDefaultCategories(ctx.householdId);

    const rows = await db
      .select()
      .from(holidays)
      .where(
        and(
          eq(holidays.householdId, ctx.householdId),
          isNull(holidays.deletedAt),
          or(eq(holidays.visibility, "shared"), eq(holidays.authorId, ctx.userId))
        )
      )
      .orderBy(asc(holidays.startsOn));

    return NextResponse.json({ holidays: rows });
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

    // Validate forPersons: must all be household members
    if (body.data.forPersons.length > 0) {
      const validUsers = await db
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, ctx.householdId),
            inArray(householdMembers.userId, body.data.forPersons)
          )
        );
      if (validUsers.length !== body.data.forPersons.length) {
        return NextResponse.json(
          { error: "forPersons must be members of this household." },
          { status: 400 }
        );
      }
    }

    const [created] = await db
      .insert(holidays)
      .values({
        householdId: ctx.householdId,
        authorId: ctx.userId,
        title: body.data.title,
        description: body.data.description ?? null,
        startsOn: body.data.startsOn,
        endsOn: body.data.endsOn ?? null,
        forPersons: body.data.forPersons,
        categoryId: body.data.categoryId ?? null,
        pushToCalendar: body.data.pushToCalendar,
        visibility: body.data.visibility,
      })
      .returning();

    // Push-to-calendar (best-effort)
    let calendarWarning: string | null = null;
    if (body.data.pushToCalendar) {
      const provider = await resolvePushProvider(ctx.userId, body.data.pushProvider ?? undefined);
      if (!provider) {
        calendarWarning = "Saved locally, but no calendar is connected to push to — connect one in Settings.";
      } else {
        try {
          const pushed = await pushHolidayToCalendar({
            userId: ctx.userId,
            provider,
            title: body.data.title,
            description: body.data.description ?? null,
            startsOn: body.data.startsOn,
            endsOn: body.data.endsOn ?? null,
          });
          if (pushed) {
            await db
              .update(holidays)
              .set({
                externalCalendarEventId: pushed.externalEventId,
                externalCalendarProvider: provider,
                externalCalendarId: pushed.calendarId,
              })
              .where(eq(holidays.id, created.id));
          }
        } catch (e) {
          console.error("push to calendar failed", e);
          calendarWarning = "Saved locally, calendar sync failed — try again from the holiday page.";
        }
      }
    }

    return NextResponse.json({
      holiday: created,
      warning: calendarWarning,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function resolvePushProvider(
  userId: string,
  preferred?: "google" | "microsoft"
): Promise<"google" | "microsoft" | null> {
  const accounts = await db
    .select({ provider: externalCalendarAccounts.provider })
    .from(externalCalendarAccounts)
    .where(eq(externalCalendarAccounts.userId, userId));
  const has = new Set(accounts.map((a) => a.provider));
  if (preferred && has.has(preferred)) return preferred;
  // Brief: Google first, Microsoft second
  if (has.has("google")) return "google";
  if (has.has("microsoft")) return "microsoft";
  return null;
}
