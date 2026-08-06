import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { bucketListCategories } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  sortOrder: z.number().int().optional(),
});

async function loadCategory(id: string, householdId: string) {
  const rows = await db
    .select()
    .from(bucketListCategories)
    .where(and(eq(bucketListCategories.id, id), eq(bucketListCategories.householdId, householdId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const category = await loadCategory(id, ctx.householdId);
    if (!category) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const update: Partial<typeof bucketListCategories.$inferInsert> = {};
    if (body.data.name !== undefined) update.name = body.data.name;
    if (body.data.sortOrder !== undefined) update.sortOrder = body.data.sortOrder;

    const [updated] = await db
      .update(bucketListCategories)
      .set(update)
      .where(eq(bucketListCategories.id, id))
      .returning();
    return NextResponse.json({ category: updated });
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
    const category = await loadCategory(id, ctx.householdId);
    if (!category) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Items keep living as "uncategorized" (FK is ON DELETE SET NULL).
    await db.delete(bucketListCategories).where(eq(bucketListCategories.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
