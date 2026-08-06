import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { bucketListCategories } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
});

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const categories = await db
      .select()
      .from(bucketListCategories)
      .where(eq(bucketListCategories.householdId, ctx.householdId))
      .orderBy(asc(bucketListCategories.sortOrder), asc(bucketListCategories.name));
    return NextResponse.json({ categories });
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
    if (!body.success) return NextResponse.json({ error: "A name is required" }, { status: 400 });

    const existing = await db
      .select({ id: bucketListCategories.id })
      .from(bucketListCategories)
      .where(
        and(
          eq(bucketListCategories.householdId, ctx.householdId),
          eq(bucketListCategories.name, body.data.name)
        )
      )
      .limit(1);
    if (existing[0]) {
      return NextResponse.json({ error: "That category already exists" }, { status: 409 });
    }

    const [category] = await db
      .insert(bucketListCategories)
      .values({ householdId: ctx.householdId, name: body.data.name })
      .returning();
    return NextResponse.json({ category }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
