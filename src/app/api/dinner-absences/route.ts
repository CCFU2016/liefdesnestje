import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dinnerAbsences, householdMembers } from "@/lib/db/schema";
import { and, between, eq, inArray } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

// Row present = user is NOT at home that night. No row = at home (default).
// Any household member can toggle any other member's attendance — this is
// a shared household calendar, not a per-user private record.

const toggleSchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  absent: z.boolean(),
});

const bulkSchema = z.object({
  entries: z
    .array(
      z.object({
        userId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        absent: z.boolean(),
      })
    )
    .min(1)
    .max(100),
});

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) return NextResponse.json({ error: "from,to required" }, { status: 400 });

    const rows = await db
      .select({
        userId: dinnerAbsences.userId,
        date: dinnerAbsences.date,
      })
      .from(dinnerAbsences)
      .where(
        and(
          eq(dinnerAbsences.householdId, ctx.householdId),
          between(dinnerAbsences.date, from, to)
        )
      );

    return NextResponse.json({ absences: rows });
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
    const parsed = toggleSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const { userId, date, absent } = parsed.data;

    // Verify the target user is actually in this household.
    const [member] = await db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, ctx.householdId)))
      .limit(1);
    if (!member) return NextResponse.json({ error: "Not a household member" }, { status: 404 });

    if (absent) {
      await db
        .insert(dinnerAbsences)
        .values({ householdId: ctx.householdId, userId, date })
        .onConflictDoNothing();
    } else {
      await db
        .delete(dinnerAbsences)
        .where(
          and(
            eq(dinnerAbsences.householdId, ctx.householdId),
            eq(dinnerAbsences.userId, userId),
            eq(dinnerAbsences.date, date)
          )
        );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Bulk replace: the weekly popup sends the full set of (user, date, absent)
// for every day of next week so one round-trip covers all members × 7 days.
export async function PUT(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const parsed = bulkSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const targetUserIds = Array.from(new Set(parsed.data.entries.map((e) => e.userId)));
    const members = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, ctx.householdId),
          inArray(householdMembers.userId, targetUserIds)
        )
      );
    const validIds = new Set(members.map((m) => m.userId));

    const toInsert = parsed.data.entries.filter((e) => e.absent && validIds.has(e.userId));
    const toDelete = parsed.data.entries.filter((e) => !e.absent && validIds.has(e.userId));

    await db.transaction(async (tx) => {
      if (toInsert.length) {
        await tx
          .insert(dinnerAbsences)
          .values(
            toInsert.map((e) => ({
              householdId: ctx.householdId,
              userId: e.userId,
              date: e.date,
            }))
          )
          .onConflictDoNothing();
      }
      for (const e of toDelete) {
        await tx
          .delete(dinnerAbsences)
          .where(
            and(
              eq(dinnerAbsences.householdId, ctx.householdId),
              eq(dinnerAbsences.userId, e.userId),
              eq(dinnerAbsences.date, e.date)
            )
          );
      }
    });

    return NextResponse.json({ ok: true, inserted: toInsert.length, cleared: toDelete.length });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
