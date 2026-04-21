import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { todoLists, todos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { nextTodoOccurrence } from "@/lib/recurrence";

const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

async function getTodoForCaller(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const t = (await db.select().from(todos).where(eq(todos.id, id)).limit(1))[0];
  if (!t) return null;
  const list = (await db.select().from(todoLists).where(eq(todoLists.id, t.listId)).limit(1))[0];
  if (!list || list.householdId !== ctx.householdId) return null;
  if (t.visibility === "private" && t.authorId !== ctx.userId) return null;
  return t;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const current = await getTodoForCaller(id, ctx);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const update: Partial<typeof todos.$inferInsert> = { updatedAt: new Date() };
    if (body.data.title !== undefined) update.title = body.data.title;
    if (body.data.notes !== undefined) update.notes = body.data.notes;
    if (body.data.dueAt !== undefined)
      update.dueAt = body.data.dueAt ? new Date(body.data.dueAt) : null;
    if (body.data.assigneeId !== undefined) update.assigneeId = body.data.assigneeId;
    if (body.data.recurrenceRule !== undefined) update.recurrenceRule = body.data.recurrenceRule;
    if (body.data.visibility !== undefined) update.visibility = body.data.visibility;
    if (body.data.sortOrder !== undefined) update.sortOrder = body.data.sortOrder;

    if (body.data.completed !== undefined) {
      const wasCompleted = !!current.completedAt;
      const now = new Date();
      update.completedAt = body.data.completed ? now : null;

      // If recurring and completing: spawn the next instance.
      if (body.data.completed && !wasCompleted && current.recurrenceRule) {
        const next = nextTodoOccurrence(
          current.recurrenceRule,
          current.dueAt ?? now,
          now
        );
        if (next) {
          await db.insert(todos).values({
            listId: current.listId,
            authorId: current.authorId,
            assigneeId: current.assigneeId,
            title: current.title,
            notes: current.notes,
            dueAt: next,
            recurrenceRule: current.recurrenceRule,
            recurrenceParentId: current.recurrenceParentId ?? current.id,
            visibility: current.visibility,
          });
        }
      }
    }

    const [updated] = await db.update(todos).set(update).where(eq(todos.id, id)).returning();
    return NextResponse.json({ todo: updated });
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
    const current = await getTodoForCaller(id, ctx);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.update(todos).set({ deletedAt: new Date() }).where(eq(todos.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
