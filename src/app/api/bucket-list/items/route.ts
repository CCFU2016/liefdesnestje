import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { bucketListItems, bucketListStars } from "@/lib/db/schema";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const linkSchema = z.object({
  url: z.string().trim().url().max(2048),
  label: z.string().trim().max(120).optional(),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  categoryId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  links: z.array(linkSchema).max(10).optional(),
});

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const items = await db
      .select()
      .from(bucketListItems)
      .where(and(eq(bucketListItems.householdId, ctx.householdId), isNull(bucketListItems.deletedAt)))
      .orderBy(asc(bucketListItems.sortOrder), desc(bucketListItems.createdAt));

    const ids = items.map((i) => i.id);
    const stars = ids.length
      ? await db.select().from(bucketListStars).where(inArray(bucketListStars.itemId, ids))
      : [];

    const starsByItem = new Map<string, { userId: string; stars: number }[]>();
    for (const s of stars) {
      const list = starsByItem.get(s.itemId) ?? [];
      list.push({ userId: s.userId, stars: s.stars });
      starsByItem.set(s.itemId, list);
    }

    return NextResponse.json({
      items: items.map((i) => ({ ...i, stars: starsByItem.get(i.id) ?? [] })),
    });
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
    if (!body.success) return NextResponse.json({ error: "A title is required" }, { status: 400 });

    const [item] = await db
      .insert(bucketListItems)
      .values({
        householdId: ctx.householdId,
        authorId: ctx.userId,
        title: body.data.title,
        categoryId: body.data.categoryId ?? null,
        notes: body.data.notes || null,
        links: body.data.links ?? [],
      })
      .returning();
    return NextResponse.json({ item: { ...item, stars: [] } }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
