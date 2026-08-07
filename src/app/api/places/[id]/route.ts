import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { visitedPlaces } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  visitedOn: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullable().optional(),
  withPersons: z.array(z.string().uuid()).min(1).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

async function loadPlace(id: string, householdId: string) {
  const rows = await db
    .select()
    .from(visitedPlaces)
    .where(
      and(
        eq(visitedPlaces.id, id),
        eq(visitedPlaces.householdId, householdId),
        isNull(visitedPlaces.deletedAt)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const place = await loadPlace(id, ctx.householdId);
    if (!place) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const update: Partial<typeof visitedPlaces.$inferInsert> = { updatedAt: new Date() };
    if (body.data.name !== undefined) update.name = body.data.name;
    if (body.data.visitedOn !== undefined) update.visitedOn = body.data.visitedOn;
    if (body.data.withPersons !== undefined) update.withPersons = body.data.withPersons;
    if (body.data.notes !== undefined) update.notes = body.data.notes || null;

    const [updated] = await db
      .update(visitedPlaces)
      .set(update)
      .where(eq(visitedPlaces.id, id))
      .returning();
    return NextResponse.json({ place: updated });
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
    const place = await loadPlace(id, ctx.householdId);
    if (!place) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db
      .update(visitedPlaces)
      .set({ deletedAt: new Date() })
      .where(eq(visitedPlaces.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
