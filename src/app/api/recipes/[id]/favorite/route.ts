import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recipeFavorites, recipes } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

async function loadRecipe(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const r = (await db.select().from(recipes).where(eq(recipes.id, id)).limit(1))[0];
  if (!r || r.householdId !== ctx.householdId || r.deletedAt) return null;
  if (r.visibility === "private" && r.authorId !== ctx.userId) return null;
  return r;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const r = await loadRecipe(id, ctx);
    if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db
      .insert(recipeFavorites)
      .values({ userId: ctx.userId, recipeId: id })
      .onConflictDoNothing();
    return NextResponse.json({ ok: true, favorite: true });
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
    await db
      .delete(recipeFavorites)
      .where(and(eq(recipeFavorites.userId, ctx.userId), eq(recipeFavorites.recipeId, id)));
    return NextResponse.json({ ok: true, favorite: false });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
