import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { todoLists, todos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const list = (await db.select().from(todoLists).where(eq(todoLists.id, id)).limit(1))[0];
    if (!list || list.householdId !== ctx.householdId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [updated] = await db.update(todoLists).set(body.data).where(eq(todoLists.id, id)).returning();
    return NextResponse.json({ list: updated });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;

    const list = (await db.select().from(todoLists).where(eq(todoLists.id, id)).limit(1))[0];
    if (!list || list.householdId !== ctx.householdId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Soft-delete all todos, then delete the list.
    await db.update(todos).set({ deletedAt: new Date() }).where(eq(todos.listId, id));
    await db.delete(todoLists).where(eq(todoLists.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
