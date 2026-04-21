import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { todoLists, todos } from "@/lib/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const createSchema = z.object({
  listId: z.string().uuid(),
  title: z.string().min(1).max(500),
  notes: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  assigneeId: z.string().uuid().optional(),
  recurrenceRule: z.string().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
});

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const listId = url.searchParams.get("listId");
    if (!listId) return NextResponse.json({ error: "listId required" }, { status: 400 });

    // Verify list belongs to caller's household
    const list = (
      await db.select().from(todoLists).where(eq(todoLists.id, listId)).limit(1)
    )[0];
    if (!list || list.householdId !== ctx.householdId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(todos)
      .where(
        and(
          eq(todos.listId, listId),
          isNull(todos.deletedAt),
          or(eq(todos.visibility, "shared"), eq(todos.authorId, ctx.userId))
        )
      )
      .orderBy(todos.sortOrder, todos.createdAt);

    return NextResponse.json({ todos: rows });
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
    const body = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const list = (
      await db.select().from(todoLists).where(eq(todoLists.id, body.data.listId)).limit(1)
    )[0];
    if (!list || list.householdId !== ctx.householdId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [created] = await db
      .insert(todos)
      .values({
        listId: body.data.listId,
        authorId: ctx.userId,
        title: body.data.title,
        notes: body.data.notes,
        dueAt: body.data.dueAt ? new Date(body.data.dueAt) : null,
        assigneeId: body.data.assigneeId,
        recurrenceRule: body.data.recurrenceRule,
        visibility: body.data.visibility ?? "shared",
      })
      .returning();

    return NextResponse.json({ todo: created });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
