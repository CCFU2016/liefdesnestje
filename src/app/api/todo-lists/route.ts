import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { todoLists } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const createSchema = z.object({
  name: z.string().min(1).max(60),
  icon: z.string().optional(),
});

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const rows = await db
      .select()
      .from(todoLists)
      .where(eq(todoLists.householdId, ctx.householdId))
      .orderBy(todoLists.sortOrder, todoLists.name);
    return NextResponse.json({ lists: rows });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const max = (
      await db
        .select({ m: todoLists.sortOrder })
        .from(todoLists)
        .where(eq(todoLists.householdId, ctx.householdId))
    ).reduce((m, r) => Math.max(m, r.m), 0);

    const [created] = await db
      .insert(todoLists)
      .values({
        householdId: ctx.householdId,
        name: body.data.name,
        icon: body.data.icon,
        sortOrder: max + 1,
      })
      .returning();
    return NextResponse.json({ list: created });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
