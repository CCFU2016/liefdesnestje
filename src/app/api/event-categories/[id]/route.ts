import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { eventCategories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

async function loadForCaller(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const c = (await db.select().from(eventCategories).where(eq(eventCategories.id, id)).limit(1))[0];
  if (!c || c.householdId !== ctx.householdId) return null;
  return c;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const c = await loadForCaller(id, ctx);
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
      const [updated] = await db
        .update(eventCategories)
        .set({
          ...(body.data.name !== undefined ? { name: body.data.name.trim().toLowerCase() } : {}),
          ...(body.data.color !== undefined ? { color: body.data.color } : {}),
          ...(body.data.sortOrder !== undefined ? { sortOrder: body.data.sortOrder } : {}),
        })
        .where(eq(eventCategories.id, id))
        .returning();
      return NextResponse.json({ category: updated });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
      }
      throw e;
    }
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
    const c = await loadForCaller(id, ctx);
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // FK on holidays.category_id is ON DELETE SET NULL — events stay,
    // just become "uncategorized"
    await db.delete(eventCategories).where(eq(eventCategories.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
