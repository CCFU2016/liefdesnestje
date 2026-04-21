import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { mealPlanEntries, recipes } from "@/lib/db/schema";
import { and, between, eq, isNull, or } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recipeId: z.string().uuid().nullable().optional(),
  freeText: z.string().min(1).max(300).nullable().optional(),
  servings: z.number().int().positive().nullable().optional(),
  visibility: z.enum(["private", "shared"]).default("shared"),
});

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) return NextResponse.json({ error: "from,to required" }, { status: 400 });

    const rows = await db
      .select({
        entry: mealPlanEntries,
        recipe: {
          id: recipes.id,
          title: recipes.title,
          imageUrl: recipes.imageUrl,
          servings: recipes.servings,
          cookTimeMinutes: recipes.cookTimeMinutes,
          prepTimeMinutes: recipes.prepTimeMinutes,
          ingredients: recipes.ingredients,
        },
      })
      .from(mealPlanEntries)
      .leftJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          eq(mealPlanEntries.householdId, ctx.householdId),
          isNull(mealPlanEntries.deletedAt),
          between(mealPlanEntries.date, from, to),
          or(
            eq(mealPlanEntries.visibility, "shared"),
            eq(mealPlanEntries.authorId, ctx.userId)
          )
        )
      )
      .orderBy(mealPlanEntries.date);

    return NextResponse.json({
      entries: rows.map((r) => ({ ...r.entry, recipe: r.recipe })),
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
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    if (!body.data.recipeId && !body.data.freeText) {
      return NextResponse.json(
        { error: "Need either a recipe or some text to describe the meal." },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(mealPlanEntries)
      .values({
        householdId: ctx.householdId,
        authorId: ctx.userId,
        date: body.data.date,
        recipeId: body.data.recipeId ?? null,
        freeText: body.data.freeText ?? null,
        servings: body.data.servings ?? null,
        visibility: body.data.visibility,
      })
      .returning();

    return NextResponse.json({ entry: created });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
