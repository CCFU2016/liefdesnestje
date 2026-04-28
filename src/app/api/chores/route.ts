import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recurringChoreCompletions, recurringChores } from "@/lib/db/schema";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  choreOccursOn,
  missedDatesForCarryover,
  todayInAmsterdam,
} from "@/lib/chores/schedule";

const choreCreateSchema = z
  .object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).nullable().optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    pointsValue: z.number().int().min(1).max(10).default(1),
    rollsOver: z.boolean().default(false),
    visibility: z.enum(["private", "shared"]).default("shared"),
  })
  .refine((d) => !d.startsOn || !d.endsOn || d.startsOn <= d.endsOn, {
    message: "endsOn must be on or after startsOn",
    path: ["endsOn"],
  });

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const today = todayInAmsterdam();
    const date = url.searchParams.get("date") ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Bad date" }, { status: 400 });
    }

    // Pull every live chore for the household. Private ones are filtered
    // to the requesting user — same pattern as todos/events.
    const chores = await db
      .select()
      .from(recurringChores)
      .where(
        and(
          eq(recurringChores.householdId, ctx.householdId),
          isNull(recurringChores.deletedAt),
          or(
            eq(recurringChores.visibility, "shared"),
            eq(recurringChores.authorId, ctx.userId)
          )
        )
      )
      .orderBy(asc(recurringChores.title));

    // Pull all completions for these chores (we need today's status + the
    // last 60 days for carryover logic). Limit window for safety.
    const choreIds = chores.map((c) => c.id);
    const completions = choreIds.length
      ? await db
          .select({
            choreId: recurringChoreCompletions.choreId,
            completedById: recurringChoreCompletions.completedById,
            completedOn: recurringChoreCompletions.completedOn,
            completedAt: recurringChoreCompletions.completedAt,
            pointsAwarded: recurringChoreCompletions.pointsAwarded,
          })
          .from(recurringChoreCompletions)
          .where(
            // Drizzle's `inArray` would be cleaner but we already have a
            // bounded number of chores per household; a small set check
            // via OR is fine and avoids importing inArray here.
            or(...choreIds.map((id) => eq(recurringChoreCompletions.choreId, id)))!
          )
      : [];

    // Build per-chore set of completed dates for the carryover walk.
    const completedByChore = new Map<string, Set<string>>();
    for (const c of completions) {
      const set = completedByChore.get(c.choreId) ?? new Set<string>();
      set.add(c.completedOn);
      completedByChore.set(c.choreId, set);
    }

    type ScheduledRow = {
      chore: (typeof chores)[number];
      completion:
        | {
            id: string | null;
            completedById: string;
            completedAt: Date;
            pointsAwarded: number;
          }
        | null;
    };

    const scheduledToday: ScheduledRow[] = [];
    for (const c of chores) {
      if (!choreOccursOn(c, date)) continue;
      const todays =
        completions.find((x) => x.choreId === c.id && x.completedOn === date) ?? null;
      scheduledToday.push({
        chore: c,
        completion: todays
          ? {
              id: null, // not exposed; not needed for UI
              completedById: todays.completedById,
              completedAt: todays.completedAt,
              pointsAwarded: todays.pointsAwarded,
            }
          : null,
      });
    }

    // Carryover only when viewing today — past/future dates don't show it.
    const carryover: { chore: (typeof chores)[number]; missedDate: string }[] = [];
    if (date === today) {
      for (const c of chores) {
        if (!c.rollsOver) continue;
        const missed = missedDatesForCarryover(
          c,
          completedByChore.get(c.id) ?? new Set(),
          today
        );
        for (const m of missed) carryover.push({ chore: c, missedDate: m });
      }
      // Oldest first across all chores so "catching up" feels chronological.
      carryover.sort((a, b) => a.missedDate.localeCompare(b.missedDate));
    }

    return NextResponse.json(
      { date, scheduledToday, carryover },
      { headers: { "cache-control": "no-store" } }
    );
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
    const body = choreCreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid input", details: body.error.issues },
        { status: 400 }
      );
    }

    const today = todayInAmsterdam();
    const [created] = await db
      .insert(recurringChores)
      .values({
        householdId: ctx.householdId,
        authorId: ctx.userId,
        title: body.data.title,
        notes: body.data.notes ?? null,
        daysOfWeek: body.data.daysOfWeek,
        startsOn: body.data.startsOn ?? null,
        endsOn: body.data.endsOn ?? null,
        pointsValue: body.data.pointsValue,
        rollsOver: body.data.rollsOver,
        // If created with rollsOver=true, peg rollsOverSince to today so we
        // don't manufacture historical debt — only future misses count.
        rollsOverSince: body.data.rollsOver ? today : null,
        visibility: body.data.visibility,
      })
      .returning();

    return NextResponse.json({ chore: created });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
