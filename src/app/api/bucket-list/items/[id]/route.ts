import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { bucketListItems } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { httpUrl } from "@/lib/validation";
import { MAX_JSON_BYTES, rejectIfTooLarge } from "@/lib/http/body-limit";

const linkSchema = z.object({
  url: z.string().trim().pipe(httpUrl),
  label: z.string().trim().max(120).optional(),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  links: z.array(linkSchema).max(10).optional(),
  completed: z.boolean().optional(),
});

async function loadItem(id: string, householdId: string) {
  const rows = await db
    .select()
    .from(bucketListItems)
    .where(
      and(
        eq(bucketListItems.id, id),
        eq(bucketListItems.householdId, householdId),
        isNull(bucketListItems.deletedAt)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const tooBig = rejectIfTooLarge(req, MAX_JSON_BYTES);
    if (tooBig) return tooBig;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const item = await loadItem(id, ctx.householdId);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const update: Partial<typeof bucketListItems.$inferInsert> = { updatedAt: new Date() };
    if (body.data.title !== undefined) update.title = body.data.title;
    if (body.data.categoryId !== undefined) update.categoryId = body.data.categoryId;
    if (body.data.notes !== undefined) update.notes = body.data.notes || null;
    if (body.data.links !== undefined) update.links = body.data.links;
    if (body.data.completed !== undefined) {
      update.completedAt = body.data.completed ? new Date() : null;
    }

    const [updated] = await db
      .update(bucketListItems)
      .set(update)
      .where(eq(bucketListItems.id, id))
      .returning();
    return NextResponse.json({ item: updated });
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
    const item = await loadItem(id, ctx.householdId);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db
      .update(bucketListItems)
      .set({ deletedAt: new Date() })
      .where(eq(bucketListItems.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
