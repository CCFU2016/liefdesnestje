import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recurringChores } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { todayInAmsterdam } from "@/lib/chores/schedule";

const patchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    notes: z.string().max(2000).nullable().optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).optional(),
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
    pointsValue: z.number().int().min(1).max(10).optional(),
    rollsOver: z.boolean().optional(),
    visibility: z.enum(["private", "shared"]).optional(),
  })
  .refine(
    (d) =>
      !d.startsOn || !d.endsOn || d.startsOn === null || d.endsOn === null || d.startsOn <= d.endsOn,
    { message: "endsOn must be on or after startsOn", path: ["endsOn"] }
  );

async function loadForCaller(
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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const current = await loadForCaller(id, ctx);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const update: Partial<typeof recurringChores.$inferInsert> = { updatedAt: new Date() };
    if (body.data.title !== undefined) update.title = body.data.title;
    if (body.data.notes !== undefined) update.notes = body.data.notes;
    if (body.data.daysOfWeek !== undefined) update.daysOfWeek = body.data.daysOfWeek;
    if (body.data.startsOn !== undefined) update.startsOn = body.data.startsOn;
    if (body.data.endsOn !== undefined) update.endsOn = body.data.endsOn;
    if (body.data.pointsValue !== undefined) update.pointsValue = body.data.pointsValue;
    if (body.data.visibility !== undefined) update.visibility = body.data.visibility;

    if (body.data.rollsOver !== undefined && body.data.rollsOver !== current.rollsOver) {
      update.rollsOver = body.data.rollsOver;
      // Peg rollsOverSince to today on a false→true flip so historical
      // misses don't suddenly surface as carryover. On true→false, leave
      // rollsOverSince alone — turning it back on later picks up where the
      // user expects, not from years ago.
      if (body.data.rollsOver) {
        update.rollsOverSince = todayInAmsterdam();
      }
    }

    const [updated] = await db
      .update(recurringChores)
      .set(update)
      .where(eq(recurringChores.id, id))
      .returning();
    return NextResponse.json({ chore: updated });
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
    const current = await loadForCaller(id, ctx);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db
      .update(recurringChores)
      .set({ deletedAt: new Date() })
      .where(eq(recurringChores.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
