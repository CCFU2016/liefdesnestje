import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { bucketListItems, bucketListStars } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const putSchema = z.object({
  stars: z.number().int().min(1).max(5),
});

async function itemExists(id: string, householdId: string): Promise<boolean> {
  const rows = await db
    .select({ id: bucketListItems.id })
    .from(bucketListItems)
    .where(
      and(
        eq(bucketListItems.id, id),
        eq(bucketListItems.householdId, householdId),
        isNull(bucketListItems.deletedAt)
      )
    )
    .limit(1);
  return !!rows[0];
}

/** Set (or update) the caller's star rating for this item. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = putSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Stars must be 1–5" }, { status: 400 });

    if (!(await itemExists(id, ctx.householdId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [row] = await db
      .insert(bucketListStars)
      .values({ itemId: id, userId: ctx.userId, stars: body.data.stars, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [bucketListStars.itemId, bucketListStars.userId],
        set: { stars: body.data.stars, updatedAt: new Date() },
      })
      .returning();
    return NextResponse.json({ star: row });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** Clear the caller's rating. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    if (!(await itemExists(id, ctx.householdId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await db
      .delete(bucketListStars)
      .where(and(eq(bucketListStars.itemId, id), eq(bucketListStars.userId, ctx.userId)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
