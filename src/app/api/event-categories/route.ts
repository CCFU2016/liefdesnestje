import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { eventCategories } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { ensureDefaultCategories } from "@/lib/event-categories";

const createSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    await ensureDefaultCategories(ctx.householdId);
    const rows = await db
      .select()
      .from(eventCategories)
      .where(eq(eventCategories.householdId, ctx.householdId))
      .orderBy(asc(eventCategories.sortOrder), asc(eventCategories.name));
    return NextResponse.json({ categories: rows });
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

    const name = body.data.name.trim().toLowerCase();
    // Max sortOrder + 1
    const existing = await db
      .select({ order: eventCategories.sortOrder })
      .from(eventCategories)
      .where(eq(eventCategories.householdId, ctx.householdId));
    const nextOrder = existing.reduce((m, r) => Math.max(m, r.order), -1) + 1;

    try {
      const [created] = await db
        .insert(eventCategories)
        .values({
          householdId: ctx.householdId,
          name,
          color: body.data.color ?? null,
          sortOrder: nextOrder,
        })
        .returning();
      return NextResponse.json({ category: created });
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
