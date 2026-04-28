import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recurringChoreCompletions, recurringChores } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const completeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function loadChore(
  id: string,
  ctx: Awaited<ReturnType<typeof requireHouseholdMember>>
) {
  const c = (
    await db.select().from(recurringChores).where(eq(recurringChores.id, id)).limit(1)
  )[0];
  if (!c) return null;
  if (c.householdId !== ctx.householdId) return null;
  if (c.deletedAt) return null;
  if (c.visibility === "private" && c.authorId !== ctx.userId) return null;
  return c;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = completeSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const chore = await loadChore(id, ctx);
    if (!chore) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Idempotent insert: the unique (chore_id, completed_on) index turns
    // a duplicate click into a no-op, and we read back the surviving row.
    // Use onConflictDoNothing to avoid the 23505 surfacing as a 500.
    const insertResult = await db
      .insert(recurringChoreCompletions)
      .values({
        choreId: id,
        completedById: ctx.userId,
        completedOn: body.data.date,
        completedAt: new Date(),
        pointsAwarded: chore.pointsValue,
      })
      .onConflictDoNothing()
      .returning();

    let row = insertResult[0];
    if (!row) {
      // Conflict — another request already wrote this completion.
      [row] = await db
        .select()
        .from(recurringChoreCompletions)
        .where(
          and(
            eq(recurringChoreCompletions.choreId, id),
            eq(recurringChoreCompletions.completedOn, body.data.date)
          )
        )
        .limit(1);
    }

    return NextResponse.json({ completion: row });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Bad date" }, { status: 400 });
    }
    const chore = await loadChore(id, ctx);
    if (!chore) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Any household member can undo — the brief was explicit that we shouldn't
    // let one user *silently* steal points, but mutual undos are fine.
    await db
      .delete(recurringChoreCompletions)
      .where(
        and(
          eq(recurringChoreCompletions.choreId, id),
          eq(recurringChoreCompletions.completedOn, date)
        )
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
