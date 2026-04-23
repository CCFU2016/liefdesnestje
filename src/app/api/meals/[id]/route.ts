import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { mealPlanEntries, recipes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const patchSchema = z.object({
  recipeId: z.string().uuid().nullable().optional(),
  freeText: z.string().min(1).max(300).nullable().optional(),
  servings: z.number().int().positive().nullable().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  cooked: z.boolean().optional(),
  restaurantName: z.string().min(1).max(200).nullable().optional(),
  restaurantUrl: z.string().url().nullable().optional(),
  restaurantMenuUrl: z.string().url().nullable().optional(),
  restaurantAddress: z.string().max(300).nullable().optional(),
  reservationAt: z.string().datetime({ offset: true }).nullable().optional(),
});

async function loadForCaller(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const e = (await db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).limit(1))[0];
  if (!e || e.householdId !== ctx.householdId || e.deletedAt) return null;
  if (e.visibility === "private" && e.authorId !== ctx.userId) return null;
  return e;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const current = await loadForCaller(id, ctx);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const update: Partial<typeof mealPlanEntries.$inferInsert> = { updatedAt: new Date() };
    if (body.data.recipeId !== undefined) update.recipeId = body.data.recipeId;
    if (body.data.freeText !== undefined) update.freeText = body.data.freeText;
    if (body.data.servings !== undefined) update.servings = body.data.servings;
    if (body.data.visibility !== undefined) update.visibility = body.data.visibility;
    if (body.data.restaurantName !== undefined) update.restaurantName = body.data.restaurantName;
    if (body.data.restaurantUrl !== undefined) update.restaurantUrl = body.data.restaurantUrl;
    if (body.data.restaurantMenuUrl !== undefined) update.restaurantMenuUrl = body.data.restaurantMenuUrl;
    if (body.data.restaurantAddress !== undefined) update.restaurantAddress = body.data.restaurantAddress;
    if (body.data.reservationAt !== undefined) {
      update.reservationAt = body.data.reservationAt ? new Date(body.data.reservationAt) : null;
    }

    if (body.data.cooked !== undefined) {
      const wasCooked = !!current.cookedAt;
      update.cookedAt = body.data.cooked ? new Date() : null;

      // Increment recipe.cookedCount on the transition false → true
      if (body.data.cooked && !wasCooked && current.recipeId) {
        await db
          .update(recipes)
          .set({ cookedCount: sql`${recipes.cookedCount} + 1`, updatedAt: new Date() })
          .where(eq(recipes.id, current.recipeId));
      }
    }

    const [updated] = await db.update(mealPlanEntries).set(update).where(eq(mealPlanEntries.id, id)).returning();
    return NextResponse.json({ entry: updated });
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
    const current = await loadForCaller(id, ctx);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.update(mealPlanEntries).set({ deletedAt: new Date() }).where(eq(mealPlanEntries.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
